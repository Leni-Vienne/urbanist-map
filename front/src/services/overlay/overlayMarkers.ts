// AI : ============================================================================
// AI : OVERLAY MARKERS - Marker creation and update functions
// AI : ============================================================================
// AI : Extracted from useOverlay.ts to manage overlay marker lifecycle
// AI : These functions handle creating, positioning, and styling overlay markers
// AI : ============================================================================

import L from "leaflet";
import { map } from "@/services/core/map";
import { getOverlayMarkerColor, createOverlayIcon } from "@/services/map/markers";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import type { OverlayObject, MarkerColor } from "@/types/index";
import {
  selectOverlay,
  highlightProjectOverlaysOnHover,
  removeProjectOutlines,
  syncModerationCityFromOverlay,
} from "@/services/overlay/overlaySelection";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import {
  getFromEditModeOverlayCache,
  getOverlayBounds,
} from "@/services/overlay/overlayPositionManagement";
import { enrichOverlayWithProject } from "@/services/overlay/overlayData";
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
  if (corners.length === 4) {
    const centroidLat = (corners[0]!.lat + corners[1]!.lat + corners[2]!.lat + corners[3]!.lat) / 4;
    const centroidLng = (corners[0]!.lng + corners[1]!.lng + corners[2]!.lng + corners[3]!.lng) / 4;
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
  function getTooltipTextForOverlay(): string {
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

  const tooltipText = getTooltipTextForOverlay();

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

// AI : getOverlayBounds moved to overlayPositionManagement.ts

// AI : enrichOverlayWithProject moved to services/overlay/overlayData.ts

/**
 * AI : Create a single marker for an overlay (for view mode overlays)
 */
export function createSingleMarker(savedOverlay: OverlayObject): void {
  const overlayStore = useOverlayStore();

  // AI : Skip replaced overlays - the replacement is at the same location, marker would be confusing
  if (savedOverlay.status === "replaced") return;

  if (overlayStore.allMarkers[savedOverlay.id]) return;

  // AI : CRITICAL: Safety check for visibility
  // AI : This prevents markers from being created for filtered-out overlays during race conditions
  const authStore = useAuthStore();
  if (!isOverlayVisible(savedOverlay, overlayStore.mode, authStore.user?.id)) {
    return;
  }

  // AI : Calculate centroid from corners using shared utility to match backend calculation
  // AI : Check edit cache first to prevent flicker when zooming back in on modified overlays
  let corners = savedOverlay.corners;
  if (overlayStore.mode === "edit") {
    const cached = getFromEditModeOverlayCache(savedOverlay.id);
    if (cached?.corners.length === 4) {
      corners = cached.corners;
    }
  }

  if (corners.length !== 4) return;

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
    // AI : UNLESS there are pending changes, in which case default to showing the suggested position (yellow marker)
    if (overlayObject.isViewingApprovedPosition === undefined) {
      if (overlayObject.hasPendingChanges) {
        overlayObject.isViewingApprovedPosition = false;
      } else {
        overlayObject.isViewingApprovedPosition = true;
      }
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
    syncModerationCityFromOverlay(overlayObject);

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

  // AI : CRITICAL: Safety check for visibility
  const authStore = useAuthStore();
  if (!isOverlayVisible(overlayObject, overlayStore.mode, authStore.user?.id)) {
    return;
  }

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

// AI : Accept HMR updates for this module
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
