import { ref } from "vue";
import type { ProjectForModeration } from "@/types/index";

// ============================================================================
// ACCORDION STATE SERVICE - Singleton state for panel accordions
// ============================================================================
// Shared accordion state that persists across My Contributions and Moderation panels
// This allows users to maintain their expanded/collapsed state when switching between panels
// ============================================================================

// ============================================================================
// STATE
// ============================================================================

export const activeAccordionPanels = ref<string[]>([]);

// ============================================================================
// SCROLL REQUESTS
// ============================================================================

type ScrollRequestType = "project" | "overlay";

interface ScrollRequest {
  type: ScrollRequestType;
  id: string | number;
}

export const pendingScrollRequest = ref<ScrollRequest | null>(null);

/**
 * Request scrolling to a specific element in the panel
 * This sets a pending request that the panel will consume when ready
 */
export function requestScrollTo(type: ScrollRequestType, id: string | number) {
  pendingScrollRequest.value = { type, id };
}

/**
 * Consume the current scroll request (retrieve and clear it)
 */
export function consumeScrollRequest(): ScrollRequest | null {
  const request = pendingScrollRequest.value;
  pendingScrollRequest.value = null;
  return request;
}

// ============================================================================
// PROJECT METHODS
// ============================================================================

function expandProjectAccordion(projectId: string) {
  if (!activeAccordionPanels.value.includes(projectId)) {
    activeAccordionPanels.value.push(projectId);
  }
}

// ============================================================================
// AUTO-EXPAND METHODS
// ============================================================================

/**
 * Auto-expand the project accordion that contains a specific overlay
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
 * Auto-expand the accordion for a specific project
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
