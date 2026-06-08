import type { Project } from "@/types/index";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { trpc } from "@/client";
import { createProjectObject } from "@/utils/typeFactories";
import { syncModerationCountryFromMapClick } from "@/services/moderation/moderationCountrySync";

/**
 * Open the project detail in the docked panel for the given project.
 * Called from vector/point clicks, project shape clicks, and the Contribute sidebar.
 * Detail-state side effects (vector hover, accordion scroll, marker opacity, overlay
 * deselect) are handled by the popup watcher initialized at boot in main.ts.
 */
export function selectProject(project: Project, _latlng?: { lat: number; lng: number }): void {
  const uiStore = useUiStore();

  if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
    uiStore.closeProjectInfoPopup();
    return;
  }

  uiStore.openProjectInfoPopup(project.id, project);

  // In moderation mode, switch the panel to this project's country so its pending
  // submissions load and the popup watcher's scroll request can resolve.
  syncModerationCountryFromMapClick(project.countryCode);
}

// Resolve a project that isn't in the project store yet: first from the moderation
// store (pending submissions), then from the backend. Returns null if neither has it.
async function resolveProjectForTileClick(projectId: string): Promise<Project | null> {
  const moderationStore = useModerationStore();
  const pendingProject = moderationStore.projects.find((p) => p.id === projectId);
  if (pendingProject) {
    return createProjectObject({
      ...pendingProject,
      tags: pendingProject.tags ?? [],
      overlayIds: [],
      city: pendingProject.city
        ? {
            ...pendingProject.city,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            coordinates: { x: 0, y: 0 },
            approvedProjectCount: 0,
          }
        : null,
    });
  }

  try {
    const result = await trpc.project.getById.query({ id: projectId });
    if (!result) return null;
    return createProjectObject({
      ...result,
      tags: result.tags ?? [],
      overlayIds: [],
    });
  } catch (error) {
    console.error("Failed to fetch project for tile click:", error);
    return null;
  }
}

/**
 * Handle a MapLibre tile click given only a project ID.
 * Looks up the project from the store or resolves it, then delegates to selectProject.
 * Any project resolved from outside the store is stored so it behaves like a loaded
 * one (editable, re-selectable) for the rest of the session.
 */
export async function handleProjectClickFromTile(
  projectId: string,
  latlng: { lat: number; lng: number },
): Promise<void> {
  const projectStore = useProjectStore();
  let project = projectStore.projects[projectId];

  if (!project) {
    const resolved = await resolveProjectForTileClick(projectId);
    if (!resolved) return;
    project = resolved;
    projectStore.updateProject(projectId, project);
  }

  selectProject(project, latlng);
}
