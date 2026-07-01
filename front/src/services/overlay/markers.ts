import { watchEffect } from "vue";
import maplibregl, { LngLat, LngLatBounds } from "maplibre-gl";
import { map } from "@/services/core/map";
import { createOverlayMarkerElement, updateOverlayMarkerColor } from "@/services/map/markersSvg";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { isOverlayVisible } from "@/services/overlay/visibility";
import type { OverlayObject, OverlayData, MarkerColor } from "@/types/index";
import type { AppMode } from "@shared/types";
import { getApprovalStatusColor, getTimelineStatusColor } from "@/utils/markerColors";
import { t } from "@/locales";
import * as registry from "@/services/overlay/mapLayers";
import { isValidQuad } from "@/services/overlay/transform";
import { getOverlayImageCorners } from "@/services/overlay/mapLayers";
import { selectOverlay } from "@/services/overlay/selection";
import { useFocusStore } from "@/stores/pinia/focusStore";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { enrichOverlayWithProject } from "@/services/overlay/data";

type Corner = { lat: number; lng: number };

/**
 * Resolve where to place the overlay's status MARKER, biased toward where the image actually
 * sits right now:
 *   0. live image position (most accurate while the overlay is rendered)
 *   1. edit-mode last-edited position from history (survives layer pruning when zooming)
 *   2. stored corners
 * Returns null when no source yields a valid 4-corner quad. Deliberately the inverse priority of
 * resolveOverlayRenderCorners, which (re)creates the image and so prefers the remembered position.
 */
function resolveOverlayMarkerCorners(overlay: OverlayData): Corner[] | null {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  const liveCorners = getOverlayImageCorners(overlay.id);
  if (isValidQuad(liveCorners)) return liveCorners;

  if (mapStore.mode === "edit") {
    const lastEdited = overlayStore.liveOverlays[overlay.id]?.history.at(-1)?.corners;
    if (isValidQuad(lastEdited)) return lastEdited;
  }

  if (isValidQuad(overlay.corners)) return overlay.corners;

  return null;
}

/**
 * Create the marker for an overlay (edit / moderation modes). Idempotent: skips overlays that
 * already have a marker, are "replaced", or fail the mode/user visibility check.
 */
export function createOverlayMarker(overlay: OverlayObject): void {
  const mapStore = useMapStore();
  const mlMap = map.value;
  // The replacement sits at the same spot, so a marker for the replaced one would confuse.
  if (overlay.status === "replaced") return;
  if (registry.getMarker(overlay.id)) return;

  const authStore = useAuthStore();
  if (!isOverlayVisible(overlay, mapStore.mode, authStore.user?.id)) return;

  const corners = resolveOverlayMarkerCorners(overlay);
  if (!corners) return;

  const centroid = calculateCentroidFromCorners(corners);
  if (!centroid) return;

  const enriched = enrichOverlayWithProject(overlay);
  const markerColor = getOverlayMarkerColor(enriched, mapStore.mode);
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
  updateMarkerTooltip(enriched, markerColor);
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

  // Default to viewing the approved position on first click.
  overlayObject.isViewingApprovedPosition ??= true;
  syncPreviewStateOnNavigation(overlayId, overlayObject.isViewingApprovedPosition);

  selectOverlay(overlayId);

  const bounds = getOverlayBounds(overlayObject);
  if (bounds) mobileAwareFlyToBounds(bounds);
}

function buildBounds(corners: Corner[]): LngLatBounds {
  const bounds = new LngLatBounds();
  for (const c of corners) {
    bounds.extend(new LngLat(c.lng, c.lat));
  }
  return bounds;
}

/**
 * Bounds for an overlay, for camera navigation. Returns null when the overlay has no valid
 * geometry so callers skip navigation instead of feeding NaN bounds to the camera.
 */
export function getOverlayBounds(overlay: OverlayData): LngLatBounds | null {
  const corners = resolveOverlayMarkerCorners(overlay);
  return corners ? buildBounds(corners) : null;
}

function getOverlayMarkerColor(
  overlayData: OverlayObject | OverlayData,
  mode: AppMode,
): MarkerColor {
  // Extract overlay-specific properties (not present on all overlay types)
  const hasBeenModified = "isModified" in overlayData ? overlayData.isModified : false;
  const hasPendingChanges =
    "hasPendingChanges" in overlayData ? overlayData.hasPendingChanges : false;
  const isViewingApprovedPosition =
    "isViewingApprovedPosition" in overlayData ? overlayData.isViewingApprovedPosition : undefined;
  const isTooBig = "isTooBig" in overlayData && overlayData.isTooBig === true;
  const isReplacement = Boolean(overlayData.replacesOverlayId);
  const status = overlayData.status;

  // Size validation error: checkOverlaySizeAndWarn only runs on edit events, so isTooBig===true
  // already implies the user resized the overlay (no need to also check hasBeenModified).
  if (mode === "edit" && isTooBig) return "red";

  // Local replacement overlay (before submission)
  if (isReplacement && hasBeenModified && status !== "approved") return "purple";

  // Viewing suggested (pending) position - show yellow only when explicitly toggled
  if (hasPendingChanges && isViewingApprovedPosition === false) {
    return "yellow";
  }

  // Approved overlay with pending changes, viewing approved position (default or explicit)
  if (hasPendingChanges && status === "approved") {
    return "green";
  }

  if (mode === "moderation" || mode === "edit") {
    return getApprovalStatusColor(status, mode, {
      isModified: hasBeenModified,
      isReplacement,
    });
  }

  // View mode: color by the project's timeline status
  const project = overlayData.project;
  if (!project) return "grey";

  return getTimelineStatusColor(project.timelineStatus);
}

/**
 * Update marker color + tooltip based on overlay storage status
 * @param overlayObject - The overlay object to update
 * @param cachedMarkerColor - Optional pre-calculated marker color to avoid redundant computation
 */
function updateMarkerTooltip(overlayObject: OverlayObject, cachedMarkerColor?: MarkerColor): void {
  const mapStore = useMapStore();
  const marker = registry.getMarker(overlayObject.id);

  if (!marker) return;

  const markerColor = cachedMarkerColor ?? getOverlayMarkerColor(overlayObject, mapStore.mode);
  updateOverlayMarkerColor(marker, markerColor);

  const element = marker.getElement();

  // View mode shows no tooltip; edit & moderation modes do.
  if (mapStore.mode === "view") {
    element.removeAttribute("title");
    return;
  }

  function getTooltipTextForOverlay(): string {
    const hasBeenModified = overlayObject.isModified;
    const hasPendingChanges = overlayObject.hasPendingChanges ?? false;
    const isReplacement = overlayObject.replacesOverlayId !== null;
    const isApproved = overlayObject.status === "approved";
    const isPending = overlayObject.status === "pending";
    const isRejected = overlayObject.status === "rejected";
    const isViewingApprovedPosition = overlayObject.isViewingApprovedPosition;

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

  element.title = getTooltipTextForOverlay();
}

/**
 * Update the marker position based on the overlay's current center
 */
export function updateMarkerPosition(overlayObject: OverlayObject): void {
  const marker = registry.getMarker(overlayObject.id);
  if (!marker) return;

  // Centroid from the live image corners so the pin tracks the overlay during edits.
  const corners = getOverlayImageCorners(overlayObject.id) ?? overlayObject.corners;
  if (corners.length === 4) {
    const centroid = calculateCentroidFromCorners(corners);
    if (centroid) marker.setLngLat([centroid.lng, centroid.lat]);
  }
}

/**
 * Set up a single watchEffect that keeps every overlay marker's color in sync with its
 * Pinia state (status, isModified, hasPendingChanges, isViewingApprovedPosition, project,
 * isTooBig, replacesOverlayId) and the current map mode. Replaces the imperative
 * updateOverlayMarkersColors call sites; data mutations that go through overlayStore /
 * batchUpdateOverlays / updateOverlay trigger this automatically.
 *
 * Initial color is set by createOverlayMarker / createMarker on creation; this effect
 * only handles subsequent changes. The _cmorgColor cache on each marker short-circuits
 * no-op setIcon calls.
 */
let markerColorTriggersInitialized = false;

export function initializeMarkerColorTriggers(): void {
  if (markerColorTriggersInitialized) return;
  markerColorTriggersInitialized = true;

  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();

  watchEffect(() => {
    const mode = mapStore.mode;
    for (const overlayObject of Object.values(overlayStore.liveOverlays)) {
      const marker = registry.getMarker(overlayObject.id);
      if (!marker) continue;
      updateMarkerTooltip(overlayObject, getOverlayMarkerColor(overlayObject, mode));
    }
  });
}
