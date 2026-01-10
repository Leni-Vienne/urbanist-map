// AI : ============================================================================
// AI : OVERLAY MARKERS - Marker creation and update functions
// AI : ============================================================================
// AI : Extracted from useOverlay.ts to manage overlay marker lifecycle
// AI : These functions handle creating, positioning, and styling overlay markers
// AI : ============================================================================

import L from "leaflet";
import { map } from "@/composables/core/useMap";
import { getOverlayMarkerColor, createOverlayIcon } from "@/composables/map/useMarkers";
import { mobileAwareFlyToBounds } from "@/composables/map/useMapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import type { OverlayObject, MarkerColor, Project } from "@/types/index";
import {
  selectOverlay,
  highlightProjectOverlaysOnHover,
  removeProjectOutlines,
} from "@/composables/overlay/useOverlaySelection";
import { syncPreviewStateOnNavigation } from "@/composables/overlay/changeRequestPreviewState";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { getFromEditModeOverlayCache } from "@/composables/overlay/useOverlayPositionManagement";
import { createOverlayObject } from "@/utils/typeFactories";
// AI : useI18n() uses Vue's inject() mechanism which is only available synchronously during the setup() phase of a component.
import { t } from "@/locales";

/**
 * AI : Update the marker position based on overlay center
 */
export function updateMarkerPosition(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay || !overlayObject.marker) {
    return;
  }

  // AI : Calculate centroid from corners (average of all 4 corners) to match backend calculation
  // AI : This ensures marker position doesn't jump when zooming in/out
  const corners = overlayObject.overlay.getCorners();
  if (corners?.length === 4) {
    const centroidLat = (corners[0].lat + corners[1].lat + corners[2].lat + corners[3].lat) / 4;
    const centroidLng = (corners[0].lng + corners[1].lng + corners[2].lng + corners[3].lng) / 4;
    overlayObject.marker.setLatLng([centroidLat, centroidLng]);
  }
}

/**
 * AI : Update marker tooltip based on overlay storage status
 * @param overlayObject - The overlay object to update
 * @param cachedMarkerColor - Optional pre-calculated marker color to avoid redundant computation
 */
export function updateMarkerTooltip(
  overlayObject: OverlayObject,
  cachedMarkerColor?: MarkerColor,
): void {
  const overlayStore = useOverlayStore();

  if (!overlayObject.marker) return;

  const markerColor = cachedMarkerColor ?? getOverlayMarkerColor(overlayObject, overlayStore.mode);
  const colorIcon = createOverlayIcon(markerColor);
  overlayObject.marker.setIcon(colorIcon);

  // AI : View mode: ensure no tooltip is bound
  // AI : Edit & Moderation modes: show tooltips
  if (overlayStore.mode === "view") {
    if (overlayObject.marker.getTooltip()) {
      overlayObject.marker.unbindTooltip();
    }
    return;
  }
  /**
   * AI : Helper to generate tooltip text based on overlay state
   */
  function getTooltipTextForOverlay(overlayObject: OverlayObject): string {
    const hasBeenModified = overlayObject.isModified;
    const hasPendingChanges = overlayObject.hasPendingChanges ?? false;
    const isReplacement = overlayObject.replacesOverlayId !== null;
    const isApproved = overlayObject.status === "approved";
    const isPending = overlayObject.status === "pending";
    const isRejected = overlayObject.status === "rejected";
    const isViewingApprovedPosition = overlayObject.isViewingApprovedPosition;

    let statusText = "";
    let modifierText = "";

    if (isReplacement && !isApproved) {
      statusText = t("markerTooltip.status.replacementOverlay");
    } else if (isPending) {
      statusText = t("markerTooltip.status.pendingApproval");
      if (hasBeenModified) {
        modifierText = t("markerTooltip.modifiers.modified");
      }
    } else if (isApproved) {
      statusText = t("common.approved");
      if (hasPendingChanges && isViewingApprovedPosition === false) {
        modifierText = t("markerTooltip.modifiers.viewingSuggested");
      } else if (hasPendingChanges && isViewingApprovedPosition !== false) {
        modifierText = t("markerTooltip.modifiers.hasPendingChanges");
      } else if (hasBeenModified) {
        modifierText = t("markerTooltip.modifiers.modified");
      }
    } else if (isRejected) {
      statusText = t("markerTooltip.status.rejected");
    } else if (hasBeenModified) {
      statusText = t("markerTooltip.status.localOverlay");
    } else {
      statusText = t("markerTooltip.status.newOverlay");
    }

    return modifierText ? `${statusText} (${modifierText})` : statusText;
  }

  const tooltipText = getTooltipTextForOverlay(overlayObject);

  // AI : Update tooltip content if it exists, otherwise bind new one
  if (overlayObject.marker.getTooltip()) {
    overlayObject.marker.setTooltipContent(tooltipText);
  } else {
    overlayObject.marker.bindTooltip(tooltipText, {
      permanent: false,
      direction: "top",
      offset: [0, -10],
    });
  }
}

/**
 * AI : Get bounds for an overlay (for camera navigation)
 */
export function getOverlayBounds(overlay: OverlayObject): L.LatLngBounds | null {
  const overlayStore = useOverlayStore();

  // AI : Priority 0: If overlay is rendered, use actual Leaflet overlay position (most accurate)
  if (overlay.overlay) {
    const actualCorners = overlay.overlay.getCorners();
    if (actualCorners?.length === 4) {
      return L.latLngBounds(actualCorners);
    }
  }

  // AI : Priority 1: Check edit mode cache if in edit mode for the most current position
  if (overlayStore.mode === "edit") {
    const cachedModifications = getFromEditModeOverlayCache(overlay.id);
    if (cachedModifications?.corners?.length === 4) {
      const corners = cachedModifications.corners.map((corner) => L.latLng(corner.lat, corner.lng));
      return L.latLngBounds(corners);
    }
  }

  // AI : Priority 2: Use overlay corners from overlayObject (pending position if hasPendingChanges, approved otherwise)
  if (overlay.corners?.length === 4) {
    const corners = overlay.corners.map((corner) => L.latLng(corner.lat, corner.lng));
    return L.latLngBounds(corners);
  }

  // AI : Priority 3: Validate all corner coordinates exist and are valid numbers
  if (!overlay.corners || overlay.corners.length !== 4) {
    return null;
  }

  const corners = overlay.corners.map((c) => L.latLng(c.lat, c.lng));

  // AI : Check if all corners are valid
  if (corners.some((c) => !c.lat || !c.lng)) {
    return null;
  }

  return L.latLngBounds(corners);
}

/**
 * AI : Enrich overlay with project data for proper marker color calculation
 * AI : Pure function - only uses stores and factory utilities
 */
export function enrichOverlayWithProject(savedOverlay: OverlayObject): OverlayObject {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const moderationStore = useModerationStore();

  let project = savedOverlay.project;

  if (!project && savedOverlay.projectId) {
    // AI : First check normal project store
    project = projectStore.projects[savedOverlay.projectId];

    // AI : If not found and in moderation mode, check moderation store
    if (!project && overlayStore.mode === "moderation") {
      const modProject = moderationStore.projects.find((p) => p.id === savedOverlay.projectId);
      if (modProject) {
        // AI : Cast moderation project to Project type (compatible enough for our needs)
        project = modProject as unknown as Project;
      }
    }
  }

  // AI : Check edit mode cache to determine if overlay has been modified locally
  const cachedModifications =
    overlayStore.mode === "edit" ? overlayStore.getFromEditModeCache(savedOverlay.id) : undefined;

  // AI : Use factory function but preserve existing data
  return createOverlayObject({
    ...savedOverlay,
    project: project ? { ...project, city: project.city ?? null } : null,
    overlay: null,
    marker: null,
    corners: savedOverlay.corners,
    // AI : Set isModified flag based on edit mode cache for proper marker color
    isModified: cachedModifications?.isModified ?? savedOverlay.isModified,
  });
}

/**
 * AI : Create a single marker for an overlay (for view mode overlays)
 */
export function createSingleMarker(savedOverlay: OverlayObject): void {
  const overlayStore = useOverlayStore();

  // AI : Skip replaced overlays - the replacement is at the same location, marker would be confusing
  if (savedOverlay.status === "replaced") return;

  if (!map.value || overlayStore.allMarkers[savedOverlay.id]) return;

  // AI : Calculate centroid from corners using shared utility to match backend calculation
  // AI : Check edit cache first to prevent flicker when zooming back in on modified overlays
  let corners = savedOverlay.corners;
  if (overlayStore.mode === "edit") {
    const cached = getFromEditModeOverlayCache(savedOverlay.id);
    if (cached?.corners?.length === 4) {
      corners = cached.corners;
    }
  }

  if (!corners || corners.length !== 4) return;

  const centroid = calculateCentroidFromCorners(corners);
  if (!centroid) return;
  const center = L.latLng(centroid.lat, centroid.lng);

  // AI : Enrich overlay with project data for proper marker color calculation
  const tempOverlayObject = enrichOverlayWithProject(savedOverlay);
  const markerColor = getOverlayMarkerColor(tempOverlayObject, overlayStore.mode);
  const colorIcon = createOverlayIcon(markerColor);

  const marker = L.marker(center, {
    icon: colorIcon,
  }).addTo(map.value);

  // AI : Add click handler to select/deselect overlay when marker is clicked
  marker.on("click", (e) => {
    // AI : Stop propagation to prevent map click handler (deselection) from firing
    L.DomEvent.stopPropagation(e);

    const overlayObject = overlayStore.overlays[savedOverlay.id];
    if (!overlayObject) return;

    // AI : Set position state for dynamic button feedback
    // AI : If no explicit position state, default to showing approved position
    if (overlayObject.isViewingApprovedPosition === undefined) {
      overlayObject.isViewingApprovedPosition = true;
    }

    // AI : Sync preview state for reactive button highlighting in change request UI
    syncPreviewStateOnNavigation(savedOverlay.id, overlayObject.isViewingApprovedPosition ?? true);

    // AI : Fly to overlay bounds first
    const bounds = getOverlayBounds(overlayObject);
    if (bounds) {
      mobileAwareFlyToBounds(bounds, {
        padding: [50, 50] as [number, number],
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }

    // AI : In moderation mode, clicking a contribution should load the city context (like clicking a city marker)
    // AI : Check for overlayObject.project which should now be populated by enrichOverlayWithProject
    if (overlayStore.mode === "moderation" && overlayObject.project?.city) {
      const mapStore = useMapStore();
      const city = overlayObject.project.city;

      // AI : Only update if we're not already on this city to avoid unnecessary updates
      if (mapStore.selectedCity?.id !== city.id) {
        mapStore.setSelectedCity({
          id: city.id,
          name: city.name,
          nameLocal: city.nameLocal,
          countryCode: city.countryCode,
        });
      }
    }

    // AI : Toggle selection - selectOverlay handles overlay.select() internally
    if (overlayStore.idSelectedOverlay === savedOverlay.id) {
      selectOverlay(null);
    } else {
      selectOverlay(savedOverlay.id);
    }
  });

  // AI : Add hover handlers to highlight overlay on marker hover
  // AI : Capture projectId to avoid non-null assertion inside callbacks
  const projectId = savedOverlay.projectId;
  if (projectId) {
    marker.on("mouseover", () => {
      highlightProjectOverlaysOnHover(projectId);
    });

    marker.on("mouseout", () => {
      removeProjectOutlines(projectId);
    });
  }

  overlayStore.allMarkers[savedOverlay.id] = marker;
  tempOverlayObject.marker = marker;
  // AI : Pass pre-calculated markerColor to avoid redundant getOverlayMarkerColor call
  updateMarkerTooltip(tempOverlayObject, markerColor);
}

/**
 * AI : Create a marker for new/replacement overlays (for edit mode)
 */
export function createMarker(overlayObject: OverlayObject): void {
  const overlayStore = useOverlayStore();

  if (!map.value) return;

  // AI : Use current map center as initial marker position
  const center = map.value.getCenter();

  // AI : Determine marker color based on overlay state
  // AI : Let getOverlayMarkerColor handle all color logic including replacements after submission
  const markerColor = getOverlayMarkerColor(overlayObject, "edit");
  const colorIcon = createOverlayIcon(markerColor);

  const marker = L.marker(center, {
    icon: colorIcon,
  }).addTo(map.value);

  // AI : Add click handler to marker to select the overlay
  marker.on("click", () => {
    // AI : Fly to overlay bounds first
    const bounds = getOverlayBounds(overlayObject);
    if (bounds) {
      mobileAwareFlyToBounds(bounds, {
        padding: [50, 50] as [number, number],
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }

    // AI : selectOverlay handles overlay.select() internally
    selectOverlay(overlayObject.id);
  });

  // AI : Store marker reference
  overlayObject.marker = marker;
  overlayStore.allMarkers[overlayObject.id] = marker;

  // AI : Update marker tooltip with proper styling
  updateMarkerTooltip(overlayObject);
}
