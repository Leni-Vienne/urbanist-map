// ============================================================================
// OVERLAY STYLE - Composable box-shadow management for overlay elements
// ============================================================================
// Multiple features (selection ring, size warning) write to the same element's
// boxShadow. This module is the single owner of all overlay shadow styling:
// it holds the CSS values and composes concurrent layers so neither clobbers
// the other. Callers just say "apply ring" / "clear ring", no CSS leaks out.
// ============================================================================

import { OVERLAY_OUTLINE_COLOR } from "@/services/map/markers";

const SELECTION_RING_BASE_SIZE = 20; // px, scaled by image resolution
const WARNING_SHADOW = "0 0 0 2px rgba(239, 68, 68, 0.3)";

type ShadowState = {
  selection: string;
  warning: string;
};

const shadowState = new WeakMap<HTMLElement, ShadowState>();

function getState(element: HTMLElement): ShadowState {
  let state = shadowState.get(element);
  if (!state) {
    state = { selection: "", warning: "" };
    shadowState.set(element, state);
  }
  return state;
}

function commit(element: HTMLElement, state: ShadowState): void {
  const parts = [state.selection, state.warning].filter(Boolean);
  element.style.boxShadow = parts.join(", ");
}

/**
 * Calculate ring thickness proportional to the image's natural resolution.
 * Larger images need thicker rings to appear the same visual weight on screen.
 */
function calculateRingSize(element: HTMLElement): number {
  try {
    const img = element instanceof HTMLImageElement ? element : element.querySelector("img");
    if (!img) return SELECTION_RING_BASE_SIZE;

    const smaller = Math.min(img.naturalWidth, img.naturalHeight);
    if (smaller <= 0) return SELECTION_RING_BASE_SIZE;

    const scaled = SELECTION_RING_BASE_SIZE * (smaller / 500);
    return Math.max(1, Math.min(50, Math.round(scaled)));
  } catch {
    return SELECTION_RING_BASE_SIZE;
  }
}

// ─── Selection / hover ring ──────────────────────────────────────────────────

/**
 * Apply the selection/hover ring to an overlay element.
 * Also suppresses the browser's native focus outline so they don't stack.
 * @param color - Optional hex color; defaults to OVERLAY_OUTLINE_COLOR (blue).
 */
export function applySelectionRing(element: HTMLElement, color = OVERLAY_OUTLINE_COLOR): void {
  const size = calculateRingSize(element);
  const state = getState(element);
  state.selection = `0 0 0 ${size}px ${color}`;
  element.style.outline = "none";
  commit(element, state);
}

export function clearSelectionRing(element: HTMLElement): void {
  const state = getState(element);
  state.selection = "";
  commit(element, state);
}

// ─── Size-warning ring ───────────────────────────────────────────────────────

/**
 * Apply the red size-warning ring to an overlay element.
 * Composed with the selection ring so neither clobbers the other.
 */
export function applyWarningRing(element: HTMLElement): void {
  const state = getState(element);
  state.warning = WARNING_SHADOW;
  commit(element, state);
}

export function clearWarningRing(element: HTMLElement): void {
  const state = getState(element);
  state.warning = "";
  commit(element, state);
}
