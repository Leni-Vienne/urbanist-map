// Multiple features (selection ring, size warning) write to the same element's
// boxShadow. This module is the single owner of all overlay shadow styling:
// it holds the CSS values and composes concurrent layers so neither clobbers
// the other. Callers just say "apply ring" / "clear ring", no CSS leaks out.

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
