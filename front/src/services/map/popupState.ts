import { ref } from "vue";
import { map } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import type L from "leaflet";

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
const POPUP_EDGE_MARGIN = 50;
const MOBILE_DRAWER_CONTROLS_BUFFER = 110;

// Picks the popup opening direction that maximises available height, then sets
// projectPopupMaxHeight so the popup CSS can clamp itself to exactly that space.
// Preference: down → up → right → left (most common cases first).
// Pass atCenter=true when the map is about to fly/pan to the latlng: after the
// animation the point will be centered in the viewport, so we compute placement
// from the center rather than the current (pre-flight) screen position, avoiding
// a placement jump when moveend fires.
export function setPopupPlacementForLatLng(latlng: L.LatLng, atCenter = false): void {
  const mapEl = map.value.getContainer();
  const mapW = mapEl.clientWidth;
  const mapH = mapEl.clientHeight;
  const point = atCenter ? { x: mapW / 2, y: mapH / 2 } : map.value.latLngToContainerPoint(latlng);

  // On mobile, subtract the drawer height + mode controls buffer from available bottom space.
  const uiStore = useUiStore();
  const mobileBlockedPx =
    window.innerWidth < 768
      ? (uiStore.mobileDrawerHeightPercent / 100) * window.innerHeight +
        MOBILE_DRAWER_CONTROLS_BUFFER
      : 0;

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
