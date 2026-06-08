import { ref } from "vue";
import { map } from "@/services/core/map";
import { isMobileViewport } from "@/composables/ui/useIsMobile";
import { predictedRestingY, mobileBottomBlockedPx } from "@/services/map/mapNavigation";

// Teleport targets, set by the anchor markers (replaces a MutationObserver in PopupContainer).
export const overlayPopupTarget = ref<HTMLElement | null>(null);
export const projectPopupTarget = ref<HTMLElement | null>(null);

export function setOverlayPopupTarget(element: HTMLElement | null) {
  overlayPopupTarget.value = element;
}

export function setProjectPopupTarget(element: HTMLElement | null) {
  projectPopupTarget.value = element;
}

type PopupPlacement = "down" | "up" | "right" | "left";
export const projectPopupPlacement = ref<PopupPlacement>("down");
export const projectPopupMaxHeight = ref<number>(500);

// Side (left/right) placements only: anchor screen-Y and the usable vertical band, which the
// component uses to slide the centered popup back on-screen.
export const projectPopupShiftBounds = ref<{ anchorY: number; top: number; bottom: number } | null>(
  null,
);

const POPUP_EST_W = 320;
const POPUP_EST_HALF_W = POPUP_EST_W / 2;
const POPUP_MIN_H = 160;
const POPUP_ANCHOR_GAP = 28;
const POPUP_EDGE_MARGIN = 55;

// Picks the opening direction maximising available height and clamps maxHeight to it. atAnchor uses
// the camera's predicted resting position rather than the pre-flight one, avoiding a jump on moveend.
export function setPopupPlacementForLatLng(
  latlng: { lat: number; lng: number },
  atAnchor = false,
): void {
  const mapEl = map.value.getContainer();
  const mapW = mapEl.clientWidth;
  const mapH = mapEl.clientHeight;
  const isMobile = isMobileViewport();
  const point = atAnchor
    ? { x: mapW / 2, y: predictedRestingY() }
    : map.value.project([latlng.lng, latlng.lat]);

  // Mobile: the drawer + mode controls eat into the usable bottom of the screen.
  const mobileBlockedPx = isMobile ? mobileBottomBlockedPx() : 0;

  const availableBelow = mapH - point.y - POPUP_ANCHOR_GAP - mobileBlockedPx - POPUP_EDGE_MARGIN;
  const availableAbove = point.y - POPUP_ANCHOR_GAP - POPUP_EDGE_MARGIN;
  const boundTop = POPUP_EDGE_MARGIN;
  const boundBottom = mapH - mobileBlockedPx - POPUP_EDGE_MARGIN;
  const availableSide = boundBottom - boundTop;
  const hCentered = point.x >= POPUP_EST_HALF_W && mapW - point.x >= POPUP_EST_HALF_W;

  let placement: PopupPlacement = "left";
  let maxHeight = availableSide;

  if (hCentered) {
    const downOk = availableBelow >= POPUP_MIN_H;
    const upOk = availableAbove >= POPUP_MIN_H;
    if (downOk && (!upOk || availableBelow >= availableAbove)) {
      placement = "down";
      maxHeight = availableBelow;
    } else if (upOk) {
      placement = "up";
      maxHeight = availableAbove;
    }
  }
  if (placement === "left" && mapW - point.x >= POPUP_EST_W) {
    placement = "right";
    maxHeight = availableSide;
  }

  projectPopupPlacement.value = placement;
  projectPopupMaxHeight.value = Math.max(maxHeight, POPUP_MIN_H);
  projectPopupShiftBounds.value = { anchorY: point.y, top: boundTop, bottom: boundBottom };
}
