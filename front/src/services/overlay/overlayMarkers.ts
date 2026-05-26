import L from "leaflet";
import { map } from "@/services/core/map";
import { legacyLeafletMap } from "@/lib/legacyLeafletMap";
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
  highlightProject,
  removeProjectOutlines,
} from "@/services/overlay/overlaySelection";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import {
  calculateCentroidFromCorners,
  validateOverlaySize,
  leafletCornersToCorners,
} from "@shared/overlayValidation";
import { useToast } from "@/composables/ui/useToast";
import { enrichOverlayWithProject } from "@/services/overlay/overlayData";
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
  if (corners?.length === 4) {
    /* oxlint-disable-next-line no-non-null-assertion */
    const centroid = calculateCentroidFromCorners(corners)!;
    marker.setLatLng(L.latLng(centroid.lat, centroid.lng));
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

  // Skip setIcon() if color unchanged -- setIcon() detaches and rebuilds the marker's
  // DOM element even when the icon is visually identical, causing unnecessary layout cost.
  // We track the current color on the marker object directly.
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

  // Visibility check: filters out overlays that don't pass mode/user conditions
  const authStore = useAuthStore();
  if (!isOverlayVisible(savedOverlay, mapStore.mode, authStore.user?.id)) {
    return;
  }

  // Use the user's last edited position in edit mode to prevent marker flicker when zooming.
  // history.at(-1) survives layer pruning since it lives on the OverlayObject in the store.
  let corners = savedOverlay.corners;
  if (mapStore.mode === "edit") {
    const lastEdited = overlayStore.overlays[savedOverlay.id]?.history.at(-1);
    if (lastEdited?.length === 4) {
      corners = lastEdited;
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
  }).addTo(legacyLeafletMap());

  marker.on("click", (e) => {
    L.DomEvent.stopPropagation(e);

    const overlayObject = overlayStore.overlays[savedOverlay.id];
    if (!overlayObject) return;

    // Default to viewing the approved position on first click
    if (overlayObject.isViewingApprovedPosition === undefined) {
      overlayObject.isViewingApprovedPosition = true;
    }

    syncPreviewStateOnNavigation(savedOverlay.id, overlayObject.isViewingApprovedPosition ?? true);

    const bounds = getOverlayBounds(overlayObject);
    if (bounds) {
      mobileAwareFlyToBounds(bounds);
    }

    // Toggle selection
    if (overlayStore.idSelectedOverlay === savedOverlay.id) {
      selectOverlay(null);
    } else {
      selectOverlay(savedOverlay.id);
    }
  });

  // Capture projectId to avoid non-null assertion inside hover callbacks
  const projectId = savedOverlay.projectId;
  if (projectId) {
    marker.on("mouseover", () => {
      highlightProject(projectId);
    });

    marker.on("mouseout", () => {
      removeProjectOutlines(projectId);
    });
  }

  registry.setMarker(savedOverlay.id, marker);
  updateMarkerTooltip(tempOverlayObject, markerColor);
}

/**
 * Create a marker for new/replacement overlays (for edit mode)
 */
export function createMarker(overlayObject: OverlayObject): void {
  const mapStore = useMapStore();

  // Visibility check: filters out overlays that don't pass mode/user conditions
  const authStore = useAuthStore();
  if (!isOverlayVisible(overlayObject, mapStore.mode, authStore.user?.id)) {
    return;
  }

  const center = map.value.getCenter();
  const markerColor = getOverlayMarkerColor(overlayObject, "edit");
  const colorIcon = createOverlayIcon(markerColor);

  const marker = L.marker(center, {
    icon: colorIcon,
  }).addTo(legacyLeafletMap());

  marker.on("click", () => {
    const bounds = getOverlayBounds(overlayObject);
    if (bounds) {
      mobileAwareFlyToBounds(bounds);
    }

    // selectOverlay handles overlay.select() internally
    selectOverlay(overlayObject.id);
  });

  registry.setMarker(overlayObject.id, marker);
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

  // Priority 1: In edit mode use the user's last edited position from history
  if (mapStore.mode === "edit") {
    const lastEdited = overlayStore.overlays[overlay.id]?.history.at(-1);
    if (lastEdited?.length === 4) {
      const corners = lastEdited.map((corner) => L.latLng(corner.lat, corner.lng));
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

  // Resolve store once to sync isTooBig so that subsequent
  // updateOverlay (Object.assign from store) propagates the correct value.
  // Without this, the store retains a stale isTooBig:true after the overlay
  // becomes valid again, causing the drag handler (which reads from the store)
  // to wrongly color the marker red.
  const overlayStore = useOverlayStore();

  if (!validation.isValid) {
    element.style.border = "4px solid #ef4444";
    applyWarningRing(element);

    if (!overlayObject.isTooBig) {
      overlayObject.isTooBig = true;
      overlayStore.updateOverlay(overlayObject.id, { isTooBig: true });
      updateMarkerTooltip(overlayObject);
    }

    // Show toast every time overlay is edited while too large
    const toast = useToast();
    toast.add({
      severity: "warn",
      summary: t("upload.overlayTooLarge"),
      detail: t("upload.maximumSizeOnMap"),
      life: 3000,
    });
  } else {
    element.style.border = "";
    clearWarningRing(element);

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
