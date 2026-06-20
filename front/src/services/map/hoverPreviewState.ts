// Reactive state and trigger helpers for the map hover preview card.
// The card shows a lightweight read-only preview when hovering over a project
// feature in the vector tile layer (desktop only, touch has no mousemove).

import { ref } from "vue";
import { isMobileViewport } from "@/composables/ui/useIsMobile";

// Inline data sourced directly from vector tile feature properties, no backend call needed.
export type HoverProjectData = {
  name: string | null;
  timelineStatus: string | null;
  tags: string[];
};

// Per-selected-tag project count inside a cluster, used when a tag filter is active so the card can
// show how many of the cluster's projects match each filtered tag. `tag` is a slug or the untagged
// sentinel (UNTAGGED_PROJECT_FILTER).
export type ClusterTagCount = {
  tag: string;
  count: number;
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
      name?: string | null;
      tagCounts?: ClusterTagCount[];
    };

export const hoverPreview = ref<HoverPreviewState | null>(null);
/** Cursor position tracked separately to avoid re-rendering card content on every mousemove. */
export const hoverPreviewX = ref(0);
export const hoverPreviewY = ref(0);

/** The project ID that was requested last, used to discard stale position updates. */
let pendingHoverId: string | null = null;
let pendingHoverX = 0;
let pendingHoverY = 0;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(): void {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

/** Hover previews are pointer-only; suppress them on mobile widths and touch frames. */
function isHoverPreviewDisabled(): boolean {
  return isMobileViewport() || globalThis.matchMedia("(hover: none)").matches;
}

/**
 * Trigger a hover preview for a single project after a short delay.
 * All display data comes directly from tile feature properties, no backend call.
 * If the same project is already shown, only updates the cursor position.
 * If the timer is already running for the same project, only updates the
 * pending position so the card appears at the latest cursor location.
 */
export function triggerProjectHover(
  projectId: string,
  data: HoverProjectData,
  x: number,
  y: number,
  immediate = false,
): void {
  if (isHoverPreviewDisabled()) return;

  if (immediate) {
    clearTimer();
    pendingHoverId = projectId;
    hoverPreviewX.value = x;
    hoverPreviewY.value = y;
    hoverPreview.value = { type: "project", projectId, data };
    return;
  }

  // Card already visible for this project, only update position refs (no content re-render)
  if (hoverPreview.value?.type === "project" && hoverPreview.value.projectId === projectId) {
    hoverPreviewX.value = x;
    hoverPreviewY.value = y;
    return;
  }

  // Timer already counting down for this project, update position without restarting
  if (pendingHoverId === projectId) {
    pendingHoverX = x;
    pendingHoverY = y;
    return;
  }

  clearTimer();
  pendingHoverId = projectId;
  pendingHoverX = x;
  pendingHoverY = y;

  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    if (pendingHoverId !== projectId) return;

    hoverPreviewX.value = pendingHoverX;
    hoverPreviewY.value = pendingHoverY;
    hoverPreview.value = { type: "project", projectId, data };
  }, 100);
}

/**
 * Show a cluster count tooltip immediately (no delay, it carries no per-project data).
 */
export function triggerClusterHover(
  count: number,
  x: number,
  y: number,
  name?: string | null,
  tagCounts?: ClusterTagCount[],
): void {
  if (isHoverPreviewDisabled()) return;

  clearTimer();
  pendingHoverId = null;
  hoverPreviewX.value = x;
  hoverPreviewY.value = y;
  hoverPreview.value = { type: "cluster", count, name, tagCounts };
}

/**
 * Update the card position without touching hoverPreview state.
 * Safe to call on every mousemove, no Vue re-render triggered.
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
  pendingHoverId = null;
  hoverPreview.value = null;
}
