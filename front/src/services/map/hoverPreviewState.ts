// Reactive state and trigger helpers for the map hover preview card.
// The card shows a lightweight read-only preview when hovering over a project
// feature in the vector tile layer (desktop only — touch has no mousemove).

import { ref } from "vue";
import { trpc } from "@/client";
import { createProjectObject } from "@/utils/typeFactories";
import { useProjectStore } from "@/stores/pinia/projectStore";
import type { Project } from "@/types/index";

export type HoverPreviewState =
  | {
      type: "project";
      projectId: string;
      /** null while the project data is still loading from the API */
      project: Project | null;
    }
  | {
      type: "cluster";
      count: number;
    };

export const hoverPreview = ref<HoverPreviewState | null>(null);
/** Cursor position tracked separately to avoid re-rendering card content on every mousemove. */
export const hoverPreviewX = ref(0);
export const hoverPreviewY = ref(0);

/** The project ID that was requested last — used to discard stale async results. */
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
 * If the same project is already shown, only updates the cursor position.
 * If the timer is already running for the same project, only updates the
 * pending position so the card appears at the latest cursor location.
 */
export function triggerProjectHover(projectId: string, x: number, y: number): void {
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

  _timer = setTimeout(async () => {
    _timer = null;
    if (_pendingId !== projectId) return;

    hoverPreviewX.value = _pendingX;
    hoverPreviewY.value = _pendingY;

    const projectStore = useProjectStore();
    const cached = projectStore.projects[projectId];
    if (cached) {
      hoverPreview.value = { type: "project", projectId, project: cached };
      return;
    }

    // Show the card in a loading state right away so the user sees immediate feedback
    hoverPreview.value = { type: "project", projectId, project: null };

    try {
      const result = await trpc.project.getById.query({ id: projectId });
      if (!result || _pendingId !== projectId) return;
      const project = createProjectObject({ ...result, tags: result.tags ?? [], overlayIds: [] });
      projectStore.updateProject(projectId, project);
      hoverPreview.value = { type: "project", projectId, project };
    } catch {
      hoverPreview.value = null;
    }
  }, 300);
}

/**
 * Show a cluster count tooltip immediately (no delay — it carries no per-project data).
 */
export function triggerClusterHover(count: number, x: number, y: number): void {
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
