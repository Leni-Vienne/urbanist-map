import type { Project, HydratedProject } from "@/types/index";
import { useProjectStore } from "@/stores/projectStore";
import { useFocusStore } from "@/stores/focusStore";
import { useModerationStore } from "@/stores/moderationStore";
import { trpc } from "@/client";
import { createProjectObject, getProjectDetailFields } from "@/utils/typeFactories";
import { syncModerationCountryFromMapClick } from "@/services/moderation/moderationCountrySync";
import { loadOrNull } from "@/services/core/errorHandling";

/**
 * Open the project detail in the docked panel for the given project.
 * Called from vector/point clicks, project shape clicks, and the Contribute sidebar.
 * Detail-state side effects (vector hover, accordion scroll, marker opacity, overlay
 * deselect) are handled by the detail watcher initialized at boot in main.ts.
 */
export function openProjectDetail(project: Project): void {
  const projectStore = useProjectStore();
  const focus = useFocusStore();

  // Selecting is idempotent: always show the project, regardless of current state. Deselection has
  // its own paths (background-map click, the card's close button). The detail panel resolves the
  // project from the store by id, so seed it there before pinning the selection. The selected project
  // is shown in the docked panel's "Selected project" card (not the accordion); the detail watcher
  // keeps it out of the expanded accordion set so it returns collapsed when deselected.
  projectStore.upsertProjectSummary(project);
  focus.setSelectionTarget({ kind: "project", projectId: project.id });
  focus.setHoverTarget(null);

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
export async function ensureProjectSummary(projectId: string): Promise<Project | null> {
  const projectStore = useProjectStore();
  const cached = projectStore.projects[projectId];
  if (cached) return cached;

  const pendingProject = useModerationStore().projects.find((p) => p.id === projectId);
  if (pendingProject) {
    return cacheProjectSummary(
      createProjectObject({ ...pendingProject, tags: pendingProject.tags, overlayIds: [] }),
    );
  }

  const result = await loadOrNull(async () => trpc.project.getById.query({ id: projectId }), {
    errorMessage: "Failed to load project",
  });
  if (!result) return null;

  const project = createProjectObject({ ...result, tags: result.tags ?? [], overlayIds: [] });
  return cacheHydratedProject(project);
}

function cacheProjectSummary(project: Project): Project {
  return useProjectStore().upsertProjectSummary(project);
}

function cacheHydratedProject(project: Project): HydratedProject {
  const projectStore = useProjectStore();
  projectStore.upsertProjectSummary(project);
  return projectStore.applyProjectDetail(project.id, getProjectDetailFields(project));
}

const detailHydrations = new Map<string, Promise<HydratedProject | null>>();

/**
 * Merge the fields getById adds on top of the viewport payload (slug, render, ownerUsername,
 * boundaryPath) into the cached project. Concurrent callers for the same id share one request.
 * Returns the merged project, or null when the fetch failed.
 */
export async function hydrateProjectDetail(projectId: string): Promise<HydratedProject | null> {
  const cached = useProjectStore().getHydratedProject(projectId);
  if (cached) return cached;

  const inFlight = detailHydrations.get(projectId);
  if (inFlight) return inFlight;

  const request = fetchProjectDetail(projectId);
  detailHydrations.set(projectId, request);
  try {
    return await request;
  } finally {
    detailHydrations.delete(projectId);
  }
}

async function fetchProjectDetail(projectId: string): Promise<HydratedProject | null> {
  const fresh = await loadOrNull(async () => trpc.project.getById.query({ id: projectId }));
  if (!fresh) return null;

  const projectStore = useProjectStore();
  const project = createProjectObject({ ...fresh, tags: fresh.tags ?? [], overlayIds: [] });
  projectStore.upsertProjectSummary(project);
  return projectStore.applyProjectDetail(projectId, getProjectDetailFields(project));
}

/**
 * Handle a MapLibre tile click given only a project ID.
 * Looks up the project, then opens its detail.
 */
export async function handleProjectClickFromTile(projectId: string): Promise<void> {
  const project = await ensureProjectSummary(projectId);
  if (!project) return;

  openProjectDetail(project);
}
