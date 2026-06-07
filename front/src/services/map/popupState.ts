import { ref } from "vue";
import { map } from "@/services/core/map";
import { isMobileViewport } from "@/composables/ui/useIsMobile";
import { predictedRestingY, mobileBottomBlockedPx } from "@/services/map/mapNavigation";

// State for tracking teleport targets
// This eliminates the need for MutationObservers in PopupContainer

export const overlayPopupTarget = ref<HTMLElement | null>(null);
export const projectPopupTarget = ref<HTMLElement | null>(null);

export function setOverlayPopupTarget(element: HTMLElement | null) {
  overlayPopupTarget.value = element;
}

export function setProjectPopupTarget(element: HTMLElement | null) {
  projectPopupTarget.value = element;
}

// Which direction the project popup opens from the anchor point.
// Computed at click time based on available viewport space.
type PopupPlacement = "down" | "up" | "right" | "left";
export const projectPopupPlacement = ref<PopupPlacement>("down");

// Maximum height (px) the popup content area is allowed to grow to.
// Set alongside placement so the popup never gets clipped by the screen edge.
export const projectPopupMaxHeight = ref<number>(500);

const POPUP_EST_W = 320;
const POPUP_EST_HALF_W = POPUP_EST_W / 2;
const POPUP_MIN_H = 160;
const POPUP_ANCHOR_GAP = 28;
const POPUP_EDGE_MARGIN = 55;

// Picks the opening direction (down → up → right → left) that maximises available height and sets
// projectPopupMaxHeight to clamp the popup to that space. Pass atAnchor=true when the camera is
// flying the point to its resting position, so placement uses that predicted position rather than
// the pre-flight one, avoiding a jump when moveend fires.
export function setPopupPlacementForLatLng(
  latlng: { lat: number; lng: number },
  atAnchor = false,
): void {
  const mapEl = map.value.getContainer();
  const mapW = mapEl.clientWidth;
  const mapH = mapEl.clientHeight;
  const isMobile = isMobileViewport();
  // Resting anchor predicted from the same framing the flight uses (drawer padding + offset), so the
  // popup placed before moveend matches where the camera actually lands.
  const point = atAnchor
    ? { x: mapW / 2, y: predictedRestingY() }
    : map.value.project([latlng.lng, latlng.lat]);

  // On mobile, subtract the drawer height + mode controls buffer from available bottom space.
  const mobileBlockedPx = isMobile ? mobileBottomBlockedPx() : 0;

  const availableBelow = mapH - point.y - POPUP_ANCHOR_GAP - mobileBlockedPx - POPUP_EDGE_MARGIN;
  const availableAbove = point.y - POPUP_ANCHOR_GAP - POPUP_EDGE_MARGIN;
  // Left/right popups are vertically centered on the anchor (translateY(-50%)), so the usable
  // height is twice the smaller of the room above and below the anchor.
  const availableSide =
    2 * Math.min(point.y - POPUP_EDGE_MARGIN, mapH - point.y - mobileBlockedPx - POPUP_EDGE_MARGIN);
  const hCentered = point.x >= POPUP_EST_HALF_W && mapW - point.x >= POPUP_EST_HALF_W;

  let placement: PopupPlacement = "left";
  let maxHeight = availableSide;

  if (hCentered) {
    // Pick whichever vertical direction has more usable space, as long as it meets the minimum.
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
}
