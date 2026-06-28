import type { Project } from "@/types/index";
import { useUiStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { trpc } from "@/client";
import { createProjectObject } from "@/utils/typeFactories";
import { syncModerationCountryFromMapClick } from "@/services/moderation/moderationCountrySync";
import { loadOrNull } from "@/services/core/errorHandling";

/**
 * Open the project detail in the docked panel for the given project.
 * Called from vector/point clicks, project shape clicks, and the Contribute sidebar.
 * Detail-state side effects (vector hover, accordion scroll, marker opacity, overlay
 * deselect) are handled by the detail watcher initialized at boot in main.ts.
 */
export function selectProject(project: Project): void {
  const uiStore = useUiStore();

  // Selecting is idempotent: always show the project, regardless of current state. Deselection has
  // its own paths (background-map click, the card's close button), so this never branches on
  // "already selected", which is what desynced after a manual fold. The selected project is shown in
  // the docked panel's "Selected project" card (not the accordion); the detail watcher keeps it out
  // of the expanded accordion set so it returns collapsed when deselected.
  uiStore.openProjectDetail(project.id, project);

  // In moderation mode, switch the panel to this project's country so its pending
  // submissions load and the detail watcher's scroll request can resolve.
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
      tags: pendingProject.tags,
      overlayIds: [],
    });
  }

  const result = await loadOrNull(async () => trpc.project.getById.query({ id: projectId }), {
    errorMessage: "Failed to fetch project for tile click",
  });

  if (!result) return null;
  return createProjectObject({
    ...result,
    tags: result.tags ?? [],
    overlayIds: [],
  });
}

/**
 * Handle a MapLibre tile click given only a project ID.
 * Looks up the project from the store or resolves it, then delegates to selectProject.
 * Any project resolved from outside the store is stored so it behaves like a loaded
 * one (editable, re-selectable) for the rest of the session.
 */
export async function handleProjectClickFromTile(projectId: string): Promise<void> {
  const projectStore = useProjectStore();
  let project = projectStore.projects[projectId];

  if (!project) {
    const resolved = await resolveProjectForTileClick(projectId);
    if (!resolved) return;
    project = resolved;
    projectStore.updateProject(projectId, project);
  }

  selectProject(project);
}
