import { watchEffect } from "vue";
import maplibregl, { type LngLatBounds } from "maplibre-gl";
import { getMap } from "@/services/core/map";
import { createOverlayMarkerElement, updateOverlayMarkerColor } from "@/services/map/markersSvg";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/overlayStore";
import { useMapStore } from "@/stores/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { isOverlayVisible } from "@/services/overlay/visibility";
import type { OverlayObject, OverlayData, MarkerColor } from "@/types/index";
import type { ApprovalStatus } from "@shared/types";
import { t } from "@/locales";
import * as registry from "@/services/overlay/mapLayers";
import { selectOverlay } from "@/services/overlay/selection";
import { useFocusStore } from "@/stores/focusStore";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { resolveOverlayCorners } from "@/services/overlay/data";
import { hasOpenChangeRequest, showsSuggestedState } from "@/services/overlay/transform";
import { isOverlayUnsaved } from "@/services/overlay/unsavedState";
import { buildLngLatBounds } from "@/utils/cornersBounds";

/**
 * Create the marker for an overlay. Overlay markers exist only in edit and moderation modes.
 */
export function createOverlayMarker(overlay: OverlayObject): void {
  const mode = useMapStore().mode;
  if (mode === "view") return;
  const mlMap = getMap();
  // The replacement sits at the same spot, so a marker for the replaced one would confuse.
  if (overlay.status === "replaced") return;
  if (registry.getMarker(overlay.id)) return;

  const authStore = useAuthStore();
  if (!isOverlayVisible(overlay, mode, authStore.user?.id)) return;

  const corners = resolveOverlayCorners(overlay, "marker");
  if (!corners) return;

  const centroid = calculateCentroidFromCorners(corners);
  if (!centroid) return;

  const markerColor = getOverlayMarkerColor(overlay, mode);
  const element = createOverlayMarkerElement(markerColor);

  const marker = new maplibregl.Marker({ element, anchor: "bottom" })
    .setLngLat([centroid.lng, centroid.lat])
    .addTo(mlMap);

  element.addEventListener("click", (e) => {
    e.stopPropagation();
    onMarkerClick(overlay.id);
  });

  const projectId = overlay.projectId;
  if (projectId) {
    const focus = useFocusStore();
    element.addEventListener("mouseenter", () => focus.setHover({ kind: "project", projectId }));
    element.addEventListener("mouseleave", () => focus.setHover(null));
  }

  registry.setMarker(overlay.id, marker);
  applyMarkerColorAndTooltip(marker, overlay, markerColor);
}

// Selection + change-request preview + camera flight for a marker click. Selection runs first
// because it drives the toolbar and edit handles and must not depend on the camera, which can
// skip on degenerate bounds.
function onMarkerClick(overlayId: string): void {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.liveOverlays[overlayId];
  if (!overlayObject) return;

  // Second click on the selected marker deselects.
  if (useFocusStore().selectedOverlayId === overlayId) {
    selectOverlay(null);
    return;
  }

  selectOverlay(overlayId);

  const bounds = getOverlayBounds(overlayObject);
  if (bounds) mobileAwareFlyToBounds(bounds);
}

/**
 * Bounds for an overlay, for camera navigation. Returns null when the overlay has no valid
 * geometry so callers skip navigation instead of feeding NaN bounds to the camera.
 */
export function getOverlayBounds(overlay: OverlayData): LngLatBounds | null {
  const corners = resolveOverlayCorners(overlay, "marker");
  return corners ? buildLngLatBounds(corners) : null;
}

function getOverlayMarkerColor(
  overlayData: OverlayObject | OverlayData,
  mode: "edit" | "moderation",
): MarkerColor {
  // Extract overlay-specific properties (not present on all overlay types)
  const hasBeenModified = isOverlayUnsaved(overlayData);
  const hasChangeRequest = hasOpenChangeRequest(overlayData, mode);
  const isTooBig = "isTooBig" in overlayData && overlayData.isTooBig === true;
  const isReplacement = Boolean(overlayData.replacesOverlayId);
  const status = overlayData.status;

  // Size validation error.
  if (mode === "edit" && isTooBig) return "red";

  // Local replacement overlay (before submission)
  if (isReplacement && hasBeenModified && status !== "approved") return "purple";

  // Open change request without a staged local edit on top; a staged edit falls through to the
  // status colors below (orange in edit mode).
  if (hasChangeRequest && !hasBeenModified) {
    if (showsSuggestedState(overlayData, mode)) return "yellow";
    if (status === "approved") return "green";
  }

  return getApprovalStatusColor(status, mode, {
    isModified: hasBeenModified,
    isReplacement,
  });
}

/**
 * Apply the marker's color and its hover tooltip text, both derived from the overlay's
 * storage status.
 */
function applyMarkerColorAndTooltip(
  marker: maplibregl.Marker,
  overlayObject: OverlayObject,
  markerColor: MarkerColor,
): void {
  const mapStore = useMapStore();

  updateOverlayMarkerColor(marker, markerColor);

  const element = marker.getElement();

  function getTooltipTextForOverlay(): string {
    const hasBeenModified = isOverlayUnsaved(overlayObject);
    const hasChangeRequest = hasOpenChangeRequest(overlayObject, mapStore.mode);
    const isReplacement = overlayObject.replacesOverlayId !== null;
    const isApproved = overlayObject.status === "approved";
    const isPending = overlayObject.status === "pending";
    const isRejected = overlayObject.status === "rejected";

    // eslint-disable-next-line init-declarations
    let statusText: string;
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
      if (hasBeenModified) {
        modifierText = t("markerTooltip.modifiers.modified");
      } else if (hasChangeRequest && showsSuggestedState(overlayObject, mapStore.mode)) {
        modifierText = t("markerTooltip.modifiers.viewingSuggested");
      } else if (hasChangeRequest) {
        modifierText = t("markerTooltip.modifiers.hasPendingChanges");
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

  element.title = getTooltipTextForOverlay();
}

function getApprovalStatusColor(
  status: ApprovalStatus | null | undefined,
  mode: "edit" | "moderation",
  options: {
    isModified?: boolean;
    isReplacement?: boolean;
  } = {},
): MarkerColor {
  const { isModified = false, isReplacement = false } = options;

  if (mode === "moderation") {
    // A replacement the user is editing stands out from the approved/pending overlays.
    if (isReplacement && isModified) return "purple";
    if (status === "pending") return "yellow";
    if (status === "approved") return "green";
    if (status === "rejected") return "red";
    return "grey";
  }

  // edit mode
  if (isModified) return "orange";
  if (status === "pending") return "yellow";
  if (status === "rejected") return "red";
  if (status === "approved") return "green";
  return "orange";
}

/**
 * Update the marker position based on the overlay's current center
 */
export function updateMarkerPosition(overlayObject: OverlayObject): void {
  const marker = registry.getMarker(overlayObject.id);
  if (!marker) return;

  // Centroid from the resolved marker position so the pin tracks the overlay during edits.
  const corners = resolveOverlayCorners(overlayObject, "marker");
  if (corners) {
    const centroid = calculateCentroidFromCorners(corners);
    if (centroid) marker.setLngLat([centroid.lng, centroid.lat]);
  }
}

export function watchMarkerColors(): () => void {
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();

  return watchEffect(() => {
    const mode = mapStore.mode;
    // On the switch to view mode every overlay marker is torn down, so there is nothing to recolor.
    if (mode === "view") return;
    for (const overlayObject of Object.values(overlayStore.liveOverlays)) {
      const marker = registry.getMarker(overlayObject.id);
      if (!marker) continue;
      applyMarkerColorAndTooltip(marker, overlayObject, getOverlayMarkerColor(overlayObject, mode));
    }
  });
}
