// Tracks a project/overlay hover state set by code OTHER than the map's mousemove handler.
// Sources include: hovering an overlay DOM element, hovering a project card in the sidebar,
// selecting an overlay, and pinning a highlight while a project detail is open.

let externalHoverId: string | null = null;
let externalHoverOverlayId: string | null = null;
let onChangeCallback: ((projectId: string | null, overlayId: string | null) => void) | null = null;

export function getExternalHoverId(): string | null {
  return externalHoverId;
}

export function getExternalHoverOverlayId(): string | null {
  return externalHoverOverlayId;
}

export function setExternalHover(projectId: string | null, overlayId: string | null = null): void {
  externalHoverId = projectId;
  externalHoverOverlayId = overlayId;
  onChangeCallback?.(projectId, overlayId);
}

/** Called by projectVectorLayers once it has the mlMap instance. */
export function registerExternalHoverCallback(
  fn: (projectId: string | null, overlayId: string | null) => void,
): void {
  onChangeCallback = fn;
}
