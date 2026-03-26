// Tracks which project is currently hovered via an overlay/marker DOM element.
// Stored here (not in projectVectorLayers) to avoid a circular dependency:
//   overlaySelection → projectVectorLayers → standaloneProjectMarkers → overlaySelection
//
// projectVectorLayers reads getOverlayDrivenHoverId() to decide whether mousemove
// should override the current hover filter.
// overlaySelection calls setOverlayDrivenHover() to drive the highlight.

let overlayDrivenHoverId: string | null = null;
let onChangeCallback: ((projectId: string | null) => void) | null = null;

export function getOverlayDrivenHoverId(): string | null {
  return overlayDrivenHoverId;
}

export function setOverlayDrivenHover(projectId: string | null): void {
  overlayDrivenHoverId = projectId;
  onChangeCallback?.(projectId);
}

/** Called by projectVectorLayers once it has the mlMap instance. */
export function registerOverlayHoverCallback(fn: (projectId: string | null) => void): void {
  onChangeCallback = fn;
}
