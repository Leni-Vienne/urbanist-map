import type { Project } from "@/types/index";
import { useProjectStore } from "@/stores/projectStore";
import { useFocusStore } from "@/stores/focusStore";
import { useModerationStore } from "@/stores/moderationStore";
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
  const projectStore = useProjectStore();
  const focus = useFocusStore();

  // Selecting is idempotent: always show the project, regardless of current state. Deselection has
  // its own paths (background-map click, the card's close button). The detail panel resolves the
  // project from the store by id, so seed it there before pinning the selection. The selected project
  // is shown in the docked panel's "Selected project" card (not the accordion); the detail watcher
  // keeps it out of the expanded accordion set so it returns collapsed when deselected.
  projectStore.updateProject(project.id, project);
  focus.selectProject(project.id);

  // In moderation mode, switch the panel to this project's country so its pending
  // submissions load and the detail watcher's scroll request can resolve.
  syncModerationCountryFromMapClick(project.countryCode);
}

/**
 * Resolve a project by id and cache it in the project store, so it behaves like a loaded one
 * (editable, re-selectable) for the rest of the session. Sources, in order: the project store,
 * the moderation store (pending submissions the backend won't serve), then the backend.
 * Returns null when none has it.
 */
export async function ensureProjectLoaded(projectId: string): Promise<Project | null> {
  const projectStore = useProjectStore();
  const cached = projectStore.projects[projectId];
  if (cached) return cached;

  const pendingProject = useModerationStore().projects.find((p) => p.id === projectId);
  if (pendingProject) {
    return cacheProject(
      createProjectObject({ ...pendingProject, tags: pendingProject.tags, overlayIds: [] }),
    );
  }

  const result = await loadOrNull(async () => trpc.project.getById.query({ id: projectId }), {
    errorMessage: "Failed to load project",
  });
  if (!result) return null;

  return cacheProject(createProjectObject({ ...result, tags: result.tags ?? [], overlayIds: [] }));
}

function cacheProject(project: Project): Project {
  useProjectStore().updateProject(project.id, project);
  return project;
}

/**
 * Handle a MapLibre tile click given only a project ID.
 * Looks up the project, then delegates to selectProject.
 */
export async function handleProjectClickFromTile(projectId: string): Promise<void> {
  const project = await ensureProjectLoaded(projectId);
  if (!project) return;

  selectProject(project);
}
