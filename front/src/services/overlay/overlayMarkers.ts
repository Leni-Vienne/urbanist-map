// ============================================================================
// OVERLAY MARKERS - Marker creation and update functions
// ============================================================================
// Extracted from useOverlay.ts to manage overlay marker lifecycle
// These functions handle creating, positioning, and styling overlay markers
// ============================================================================

import L from "leaflet";
import { map } from "@/services/core/map";
import { getOverlayMarkerColor, createOverlayIcon } from "@/services/map/markers";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import type { OverlayObject, OverlayData, MarkerColor } from "@/types/index";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { applyWarningRing, clearWarningRing } from "@/services/overlay/overlayStyle";
import {
  selectOverlay,
  highlightProjectOverlaysOnHover,
  removeProjectOutlines,
  syncModerationCityFromOverlay,
} from "@/services/overlay/overlaySelection";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import {
  calculateCentroidFromCorners,
  validateOverlaySize,
  leafletCornersToCorners,
} from "@shared/overlayValidation";
import { useToast } from "@/composables/ui/useToast";
import { enrichOverlayWithProject } from "@/services/overlay/overlayData";
// useI18n() uses Vue's inject() mechanism which is only available synchronously during the setup() phase of a component.
import { t } from "@/locales";

/**
 * Update the marker position based on overlay center
 */
export function updateMarkerPosition(overlayObject: OverlayObject): void {
  const layer = registry.getLayer(overlayObject.id);
  const marker = registry.getMarker(overlayObject.id);
  if (!layer || !marker) {
    return;
  }

  // Calculate centroid from corners (average of all 4 corners) to match backend calculation
  // This ensures marker position doesn't jump when zooming in/out
  const corners = layer.getCorners();
  if (corners.length === 4) {
    // oxlint-disable-next-line no-non-null-assertion
    const centroidLat = (corners[0]!.lat + corners[1]!.lat + corners[2]!.lat + corners[3]!.lat) / 4;
    // oxlint-disable-next-line no-non-null-assertion
    const centroidLng = (corners[0]!.lng + corners[1]!.lng + corners[2]!.lng + corners[3]!.lng) / 4;
    marker.setLatLng([centroidLat, centroidLng]);
  }
}

/**
 * Update marker tooltip based on overlay storage status
 * @param overlayObject - The overlay object to update
 * @param cachedMarkerColor - Optional pre-calculated marker color to avoid redundant computation
 */
export function updateMarkerTooltip(
  overlayObject: OverlayObject,
  cachedMarkerColor?: MarkerColor,
): void {
  const mapStore = useMapStore();
  const marker = registry.getMarker(overlayObject.id);

  if (!marker) return;

  const markerColor = cachedMarkerColor ?? getOverlayMarkerColor(overlayObject, mapStore.mode);

  // Skip setIcon() if color hasn't changed — setIcon() detaches and rebuilds the marker's
  // DOM element even when the icon is visually identical, causing unnecessary layout cost.
  // We track the current color on the marker object directly (no separate Map needed,
  // no cleanup required when the marker is removed).
  const markerWithColor = marker as L.Marker & { _cmorgColor?: MarkerColor };
  if (markerWithColor._cmorgColor !== markerColor) {
    marker.setIcon(createOverlayIcon(markerColor));
    markerWithColor._cmorgColor = markerColor;
  }

  // View mode: ensure no tooltip is bound
  // Edit & Moderation modes: show tooltips
  if (mapStore.mode === "view") {
    if (marker.getTooltip()) {
      marker.unbindTooltip();
    }
    return;
  }
  /**
   * Helper to generate tooltip text based on overlay state
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

  // Update tooltip content if it exists, otherwise bind new one
  if (marker.getTooltip()) {
    marker.setTooltipContent(tooltipText);
  } else {
    marker.bindTooltip(tooltipText, {
      permanent: false,
      direction: "top",
      offset: [0, -10],
    });
  }
}

/**
 * Create a single marker for an overlay (for view mode overlays)
 */
export function createSingleMarker(savedOverlay: OverlayObject): void {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Skip replaced overlays - the replacement is at the same location, marker would be confusing
  if (savedOverlay.status === "replaced") {
    return;
  }

  if (registry.getMarker(savedOverlay.id)) {
    return;
  }

  // CRITICAL: Safety check for visibility
  // This prevents markers from being created for filtered-out overlays during race conditions
  const authStore = useAuthStore();
  if (!isOverlayVisible(savedOverlay, mapStore.mode, authStore.user?.id)) {
    return;
  }

  // Calculate centroid from corners using shared utility to match backend calculation
  // Check edit cache first to prevent flicker when zooming back in on modified overlays
  let corners = savedOverlay.corners;
  if (mapStore.mode === "edit") {
    const cached = overlayStore.getFromEditModeCache(savedOverlay.id);
    if (cached?.corners.length === 4) {
      corners = cached.corners;
    }
  }

  if (corners.length !== 4) {
    return;
  }

  const centroid = calculateCentroidFromCorners(corners);
  if (!centroid) {
    return;
  }
  const center = L.latLng(centroid.lat, centroid.lng);

  // Enrich overlay with project data for proper marker color calculation
  const tempOverlayObject = enrichOverlayWithProject(savedOverlay);
  const markerColor = getOverlayMarkerColor(tempOverlayObject, mapStore.mode);
  const colorIcon = createOverlayIcon(markerColor);

  const marker = L.marker(center, {
    icon: colorIcon,
  }).addTo(map.value);

  // Add click handler to select/deselect overlay when marker is clicked
  marker.on("click", (e) => {
    // Stop propagation to prevent map click handler (deselection) from firing
    L.DomEvent.stopPropagation(e);

    const overlayObject = overlayStore.overlays[savedOverlay.id];
    if (!overlayObject) return;

    // Set position state for dynamic button feedback
    // Default to viewing the approved position on first click
    if (overlayObject.isViewingApprovedPosition === undefined) {
      overlayObject.isViewingApprovedPosition = true;
    }

    // Sync preview state for reactive button highlighting in change request UI
    syncPreviewStateOnNavigation(savedOverlay.id, overlayObject.isViewingApprovedPosition ?? true);

    // Fly to overlay bounds first
    const bounds = getOverlayBounds(overlayObject);
    if (bounds) {
      mobileAwareFlyToBounds(bounds, {
        padding: [50, 50] as [number, number],
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }

    // In moderation mode, clicking a contribution should load the city context (like clicking a city marker)
    // Check for overlayObject.project which should now be populated by enrichOverlayWithProject
    syncModerationCityFromOverlay(overlayObject);

    // Toggle selection - selectOverlay handles overlay.select() internally
    if (overlayStore.idSelectedOverlay === savedOverlay.id) {
      selectOverlay(null);
    } else {
      selectOverlay(savedOverlay.id);
    }
  });

  // Add hover handlers to highlight overlay on marker hover
  // Capture projectId to avoid non-null assertion inside callbacks
  const projectId = savedOverlay.projectId;
  if (projectId) {
    marker.on("mouseover", () => {
      highlightProjectOverlaysOnHover(projectId);
    });

    marker.on("mouseout", () => {
      removeProjectOutlines(projectId);
    });
  }

  registry.setMarker(savedOverlay.id, marker);
  // Pass pre-calculated markerColor to avoid redundant getOverlayMarkerColor call
  updateMarkerTooltip(tempOverlayObject, markerColor);
}

/**
 * Create a marker for new/replacement overlays (for edit mode)
 */
export function createMarker(overlayObject: OverlayObject): void {
  const mapStore = useMapStore();

  // CRITICAL: Safety check for visibility
  const authStore = useAuthStore();
  if (!isOverlayVisible(overlayObject, mapStore.mode, authStore.user?.id)) {
    return;
  }

  // Use current map center as initial marker position
  const center = map.value.getCenter();

  // Determine marker color based on overlay state
  // Let getOverlayMarkerColor handle all color logic including replacements after submission
  const markerColor = getOverlayMarkerColor(overlayObject, "edit");
  const colorIcon = createOverlayIcon(markerColor);

  const marker = L.marker(center, {
    icon: colorIcon,
  }).addTo(map.value);

  // Add click handler to marker to select the overlay
  marker.on("click", () => {
    // Fly to overlay bounds first
    const bounds = getOverlayBounds(overlayObject);
    if (bounds) {
      mobileAwareFlyToBounds(bounds, {
        padding: [50, 50] as [number, number],
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }

    // selectOverlay handles overlay.select() internally
    selectOverlay(overlayObject.id);
  });

  // Register marker in registry
  registry.setMarker(overlayObject.id, marker);

  // Update marker tooltip with proper styling
  updateMarkerTooltip(overlayObject);
}

/**
 * Get bounds for an overlay (for camera navigation)
 */
export function getOverlayBounds(overlay: OverlayData): L.LatLngBounds | null {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Priority 0: If overlay is rendered, use actual Leaflet overlay position (most accurate)
  const layer = registry.getLayer(overlay.id);
  if (layer) {
    const actualCorners = layer.getCorners();
    if (actualCorners?.length === 4) {
      return L.latLngBounds(actualCorners);
    }
  }

  // Priority 1: Check edit mode cache if in edit mode for the most current position
  if (mapStore.mode === "edit") {
    const cachedModifications = overlayStore.getFromEditModeCache(overlay.id);
    if (cachedModifications?.corners.length === 4) {
      const corners = cachedModifications.corners.map((corner) => L.latLng(corner.lat, corner.lng));
      return L.latLngBounds(corners);
    }
  }

  // Priority 2: Use overlay corners from overlayData
  if (overlay.corners.length === 4) {
    const corners = overlay.corners.map((corner) => L.latLng(corner.lat, corner.lng));
    return L.latLngBounds(corners);
  }

  return null;
}

/**
 * Check overlay size in real-time and show visual warning if too large.
 * Moved here from overlayEditing to break the overlayRendering ↔ overlayEditing cycle.
 */
export function checkOverlaySizeAndWarn(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
): void {
  const corners = overlay.getCorners();

  // Guard clause - corners can be undefined for newly created overlays
  if (corners?.length !== 4) {
    return;
  }

  const cornersArray = leafletCornersToCorners(corners);
  const validation = validateOverlaySize(cornersArray);

  const element = overlay.getElement();
  if (!element) return;

  // Resolve store once — needed to sync isTooBig so that subsequent
  // updateOverlay (Object.assign from store) propagates the correct value.
  // Without this, the store retains a stale isTooBig:true after the overlay
  // becomes valid again, causing the drag handler (which reads from the store)
  // to wrongly color the marker red.
  const overlayStore = useOverlayStore();

  if (!validation.isValid) {
    // Add red border to indicate size problem
    element.style.border = "4px solid #ef4444";
    applyWarningRing(element);

    // Update marker color if not already marked
    if (!overlayObject.isTooBig) {
      overlayObject.isTooBig = true;
      overlayStore.updateOverlay(overlayObject.id, { isTooBig: true });
      updateMarkerTooltip(overlayObject);
    }

    // Show toast message every time overlay is edited while too large
    const toast = useToast();
    toast.add({
      severity: "warn",
      summary: t("upload.overlayTooLarge"),
      detail: t("upload.maximumSizeOnMap"),
      life: 3000,
    });
  } else {
    // Remove warning styling
    element.style.border = "";
    clearWarningRing(element);

    // Clear size issue flag and update marker color
    if (overlayObject.isTooBig) {
      overlayObject.isTooBig = false;
      overlayStore.updateOverlay(overlayObject.id, { isTooBig: false });
      updateMarkerTooltip(overlayObject);
    }
  }
}

// oxlint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
