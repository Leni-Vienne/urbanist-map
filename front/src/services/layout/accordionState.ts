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
 * Consume the current scroll request (retrieve and clear it).
 */
export function consumeScrollRequest(): ScrollRequest | null {
  const request = pendingScrollRequest.value;
  pendingScrollRequest.value = null;
  return request;
}

function expandProjectAccordion(projectId: string) {
  if (!activeAccordionPanels.value.includes(projectId)) {
    activeAccordionPanels.value.push(projectId);
  }
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
      const alreadyExpanded = activeAccordionPanels.value.includes(project.id);
      if (!alreadyExpanded) {
        activeAccordionPanels.value.push(project.id);
      }
      return !alreadyExpanded;
    }
  }

  return false;
}

/**
 * Auto-expand the accordion for a specific project.
 */
export function expandAccordionForProject(
  projectId: string,
  projects: ProjectForModeration[],
): boolean {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return false;

  expandProjectAccordion(project.id);
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
