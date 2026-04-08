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
export type PopupPlacement = "down" | "up" | "right" | "left";
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
export function setPopupPlacementForLatLng(latlng: L.LatLng): void {
  const mapEl = map.value.getContainer();
  const mapW = mapEl.clientWidth;
  const mapH = mapEl.clientHeight;
  const point = map.value.latLngToContainerPoint(latlng);

  // On mobile, subtract the drawer height + mode controls buffer from available bottom space.
  const uiStore = useUiStore();
  const mobileBlockedPx =
    window.innerWidth < 768
      ? (uiStore.mobileDrawerHeightPercent / 100) * window.innerHeight +
        MOBILE_DRAWER_CONTROLS_BUFFER
      : 0;

  const availableBelow = mapH - point.y - POPUP_ANCHOR_GAP - mobileBlockedPx - POPUP_EDGE_MARGIN;
  const availableAbove = point.y - POPUP_ANCHOR_GAP - POPUP_EDGE_MARGIN;
  const availableRight = mapH - POPUP_EDGE_MARGIN * 2;
  const hCentered = point.x >= POPUP_EST_HALF_W && mapW - point.x >= POPUP_EST_HALF_W;

  let placement: PopupPlacement = "left";
  let maxHeight = availableRight;

  if (hCentered && availableBelow >= POPUP_MIN_H) {
    placement = "down";
    maxHeight = availableBelow;
  } else if (hCentered && availableAbove >= POPUP_MIN_H) {
    placement = "up";
    maxHeight = availableAbove;
  } else if (mapW - point.x >= POPUP_EST_W) {
    placement = "right";
    maxHeight = availableRight;
  }

  projectPopupPlacement.value = placement;
  projectPopupMaxHeight.value = Math.max(maxHeight, POPUP_MIN_H);
}
