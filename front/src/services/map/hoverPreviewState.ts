// Reactive state and trigger helpers for the map hover preview card.
// The card shows a lightweight read-only preview when hovering over a project
// feature in the vector tile layer (desktop only — touch has no mousemove).

import { ref } from "vue";

// Inline data sourced directly from vector tile feature properties — no backend call needed.
export type HoverProjectData = {
  name: string | null;
  timelineStatus: string | null;
  tags: string[];
};

type HoverPreviewState =
  | {
      type: "project";
      projectId: string;
      data: HoverProjectData;
    }
  | {
      type: "cluster";
      count: number;
    };

export const hoverPreview = ref<HoverPreviewState | null>(null);
/** Cursor position tracked separately to avoid re-rendering card content on every mousemove. */
export const hoverPreviewX = ref(0);
export const hoverPreviewY = ref(0);

/** The project ID that was requested last — used to discard stale position updates. */
let _pendingId: string | null = null;
let _pendingX = 0;
let _pendingY = 0;
let _timer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(): void {
  if (_timer !== null) {
    clearTimeout(_timer);
    _timer = null;
  }
}

/**
 * Trigger a hover preview for a single project after a short delay.
 * All display data comes directly from tile feature properties — no backend call.
 * If the same project is already shown, only updates the cursor position.
 * If the timer is already running for the same project, only updates the
 * pending position so the card appears at the latest cursor location.
 */
export function triggerProjectHover(
  projectId: string,
  data: HoverProjectData,
  x: number,
  y: number,
): void {
  // Disable hover preview on mobile/touch frames
  if (globalThis.innerWidth <= 768 || globalThis.matchMedia("(hover: none)").matches) return;

  // Card already visible for this project — only update position refs (no content re-render)
  if (hoverPreview.value?.type === "project" && hoverPreview.value.projectId === projectId) {
    hoverPreviewX.value = x;
    hoverPreviewY.value = y;
    return;
  }

  // Timer already counting down for this project — update position without restarting
  if (_pendingId === projectId) {
    _pendingX = x;
    _pendingY = y;
    return;
  }

  clearTimer();
  _pendingId = projectId;
  _pendingX = x;
  _pendingY = y;

  _timer = setTimeout(() => {
    _timer = null;
    if (_pendingId !== projectId) return;

    hoverPreviewX.value = _pendingX;
    hoverPreviewY.value = _pendingY;
    hoverPreview.value = { type: "project", projectId, data };
  }, 300);
}

/**
 * Show a cluster count tooltip immediately (no delay — it carries no per-project data).
 */
export function triggerClusterHover(count: number, x: number, y: number): void {
  // Disable hover preview on mobile/touch frames
  if (globalThis.innerWidth <= 768 || globalThis.matchMedia("(hover: none)").matches) return;

  clearTimer();
  _pendingId = null;
  hoverPreviewX.value = x;
  hoverPreviewY.value = y;
  hoverPreview.value = { type: "cluster", count };
}

/**
 * Update the card position without touching hoverPreview state.
 * Safe to call on every mousemove — no Vue re-render triggered.
 */
export function updateHoverPreviewPosition(x: number, y: number): void {
  hoverPreviewX.value = x;
  hoverPreviewY.value = y;
}

/**
 * Hide the hover preview and cancel any pending delay timer.
 */
export function clearHoverPreview(): void {
  clearTimer();
  _pendingId = null;
  hoverPreview.value = null;
}
