import { ref } from "vue";
import type { ProjectForModeration } from "@/types/index";

// Shared accordion state that persists across My Contributions and Moderation panels,
// allowing the expanded/collapsed state to survive panel switches.

export const activeAccordionPanels = ref<string[]>([]);

type ScrollRequestType = "project" | "overlay";

interface ScrollRequest {
  type: ScrollRequestType;
  id: string | number;
}

export const pendingScrollRequest = ref<ScrollRequest | null>(null);

/**
 * Request scrolling to a specific element in the panel.
 * Sets a pending request that the panel consumes when ready.
 */
export function requestScrollTo(type: ScrollRequestType, id: string | number) {
  pendingScrollRequest.value = { type, id };
}

/**
 * Ensure a project's accordion panel is expanded. Works for both own-contribution and
 * pinned-external projects since it operates directly on the shared panel state, unlike
 * the scroll-request path which only resolves projects in a given panel's list.
 * Returns true if the panel was collapsed and is now expanded.
 */
export function expandProjectPanel(projectId: string): boolean {
  if (!activeAccordionPanels.value.includes(projectId)) {
    activeAccordionPanels.value.push(projectId);
    return true;
  }
  return false;
}

/**
 * Consume the current scroll request (retrieve and clear it).
 */
export function consumeScrollRequest(): ScrollRequest | null {
  const request = pendingScrollRequest.value;
  pendingScrollRequest.value = null;
  return request;
}

/**
 * Auto-expand the project accordion that contains a specific overlay.
 */
export function expandAccordionForOverlay(
  overlayId: string,
  projects: ProjectForModeration[],
): boolean {
  for (const project of projects) {
    const overlay = project.overlays.find((o) => o.id === overlayId);
    if (overlay) {
      return expandProjectPanel(project.id);
    }
  }

  return false;
}
