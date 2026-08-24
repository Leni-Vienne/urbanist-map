import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type {
  Project,
  HydratedProject,
  ContributionProject,
  OverlayObject,
  Overlay,
} from "@/types/index";
import type { AppMode, ApprovalStatus } from "@shared/types";
import { createLocalOverlayContribution, hasProjectDetailFields } from "@/utils/typeFactories";

// Strips the inline overlay list off a contribution so only Project data lands in the project map.
function toProject(contribution: ContributionProject): Project {
  const { overlays: _overlays, ...project } = contribution;
  return project;
}

function preserveProjectDetail(project: Project, current: HydratedProject): Project {
  return {
    ...current,
    ...project,
    slug: current.slug,
    render: current.render,
    ownerUsername: current.ownerUsername,
    boundaryPath: current.boundaryPath,
  };
}

export const useProjectStore = defineStore("project", () => {
  // Single source of truth for project summaries, including projects listed in contributions.
  const projects = ref<Record<string, Project>>({});
  // Backend and optimistic list metadata grouped exactly as the contribution UI consumes it.
  // Project summaries remain in projects, while this record owns list membership and inline overlays.
  const userContributionOverlays = ref<Record<string, Overlay[]>>({});
  const userContributionsLoading = ref(false);
  const userContributionsLoaded = ref(false);

  // Snapshots of projects before local modifications (for change detection / reset)
  const originalProjects = ref<Record<string, Project>>({});

  function getOriginalProject(projectId: string): Project | null {
    return originalProjects.value[projectId] ?? null;
  }

  // Snapshot a project's current state as the change-detection baseline. No-op if one exists.
  function snapshotOriginal(project: Project): void {
    if (originalProjects.value[project.id]) return;
    originalProjects.value[project.id] = { ...project };
  }

  function getProjectById(projectId: string): Project | null {
    return projects.value[projectId] ?? null;
  }

  // Map consumers use local project state only in edit mode. Other modes read the backend baseline
  // while an edit is staged.
  function getMapProjectById(projectId: string, mode: AppMode): Project | null {
    const current = projects.value[projectId];
    if (!current) return null;
    if (mode === "edit" || !current.isModified) return current;
    return originalProjects.value[projectId] ?? current;
  }

  function getHydratedProject(projectId: string): HydratedProject | null {
    const project = projects.value[projectId];
    return project && hasProjectDetailFields(project) ? project : null;
  }

  function upsertProjectSummary(project: Project): Project {
    const current = projects.value[project.id];
    let stored = project;
    if (current && hasProjectDetailFields(current)) {
      stored = preserveProjectDetail(project, current);
    } else if (current) {
      stored = { ...current, ...project };
    }
    projects.value[project.id] = stored;
    if (stored.status !== null) snapshotOriginal(stored);
    return stored;
  }

  // Adopt a backend map payload without replacing a locally edited object. The backend value
  // becomes the non-edit-mode baseline until the local changes are submitted or reset.
  function adoptBackendProjectSummary(project: Project): Project {
    const current = projects.value[project.id];
    const baseline =
      current && hasProjectDetailFields(current)
        ? preserveProjectDetail(project, current)
        : project;
    if (current?.isModified) {
      originalProjects.value[project.id] = baseline;
      return current;
    }
    const stored = upsertProjectSummary(project);
    if (stored.status !== null) originalProjects.value[project.id] = { ...stored };
    return stored;
  }

  function upsertHydratedProject(project: HydratedProject): HydratedProject {
    const current = projects.value[project.id];
    const stored: HydratedProject =
      current?.isModified && current.status !== null
        ? {
            ...current,
            slug: project.slug,
            render: project.render,
            ownerUsername: project.ownerUsername,
            boundaryPath: project.boundaryPath,
          }
        : project;
    projects.value[project.id] = stored;
    originalProjects.value[project.id] = { ...project };
    return stored;
  }

  function removeProject(projectId: string): void {
    // oxlint-disable-next-line no-dynamic-delete
    delete projects.value[projectId];
    // oxlint-disable-next-line no-dynamic-delete
    delete originalProjects.value[projectId];
  }

  function setUserContributions(contributions: ContributionProject[]) {
    const nextOverlays: Record<string, Overlay[]> = {};
    for (const contribution of contributions) {
      const incoming = toProject(contribution);
      // Keep locally edited projects; otherwise adopt the fresher backend payload.
      const existing = projects.value[contribution.id];
      const stored = existing?.isModified ? existing : upsertProjectSummary(incoming);
      snapshotOriginal(stored);
      nextOverlays[contribution.id] = contribution.overlays;
    }
    userContributionOverlays.value = nextOverlays;
    userContributionsLoaded.value = true;
  }

  function setUserContributionsLoading(loading: boolean) {
    userContributionsLoading.value = loading;
  }

  // Optimistically add new overlay to user contributions without a backend fetch.
  function addOverlayToUserContributions(
    overlay: OverlayObject,
    project: Project,
    filename: string,
    authorUsername: string | null,
    existingProjectOverlays: OverlayObject[] = [],
  ) {
    if (!userContributionsLoaded.value) {
      return;
    }

    const overlayMetadata = createLocalOverlayContribution(
      { ...overlay, filename, projectId: project.id, status: "pending" as const, version: 1 },
      project,
      authorUsername,
    );

    const currentOverlays = userContributionOverlays.value[project.id];
    if (currentOverlays) {
      if (!currentOverlays.some((current) => current.id === overlayMetadata.id)) {
        userContributionOverlays.value[project.id] = [...currentOverlays, overlayMetadata];
      }
      return;
    }

    // Project not yet a contribution. Local (unsubmitted) projects are surfaced by the live merge,
    // not this map, so skip them here.
    if (project.status === null) {
      return;
    }

    let stored = projects.value[project.id];
    if (!stored) {
      stored = project;
      projects.value[project.id] = stored;
    }
    const existingMetadata = existingProjectOverlays.map((existing) =>
      createLocalOverlayContribution(existing, project, null),
    );
    userContributionOverlays.value[project.id] = [...existingMetadata, overlayMetadata];
    snapshotOriginal(stored);
  }

  // Optimistically attach a just-published render to its project in My Contributions, so the
  // overlay list updates without a refetch. Renders skip the local overlayStore flow that map
  // overlays use, so they need their own insertion. No-op only when the list isn't loaded; the
  // next fetch reconciles regardless.
  function addRenderToUserContributions(
    projectId: string,
    render: {
      id: string;
      filename: string;
      status: ApprovalStatus | null;
      authorId: string | null;
    },
    authorUsername: string | null,
  ) {
    if (!userContributionsLoaded.value) return;
    const parent = projects.value[projectId];
    if (!parent) return;

    const overlay = createLocalOverlayContribution(
      {
        id: render.id,
        caption: null,
        filename: render.filename,
        projectId,
        authorId: render.authorId,
        replacesOverlayId: null,
        status: render.status,
        version: 1,
      },
      parent,
      authorUsername,
      "render",
    );

    const currentOverlays = userContributionOverlays.value[projectId];
    if (currentOverlays) {
      if (!currentOverlays.some((current) => current.id === overlay.id)) {
        userContributionOverlays.value[projectId] = [...currentOverlays, overlay];
      }
      return;
    }

    // Render added to a project not yet in My Contributions (e.g. an imported project the user
    // didn't own). The backend lists it as a contribution once authored, so mirror that here.
    if (parent.status === null) return;
    userContributionOverlays.value[projectId] = [overlay];
  }

  // Optimistically add new project to user contributions without a backend fetch.
  function addProjectToUserContributions(project: Project) {
    if (!userContributionsLoaded.value) {
      return;
    }

    if (project.status === null) {
      return;
    }

    if (userContributionOverlays.value[project.id]) {
      return;
    }

    userContributionOverlays.value[project.id] = [];
    let stored = projects.value[project.id];
    if (!stored) {
      stored = project;
      projects.value[project.id] = stored;
    }
    snapshotOriginal(stored);
  }

  // Update pending overlay in user contributions (for caption/field updates)
  function updateOverlayInUserContributions(
    projectId: string,
    overlayId: string,
    updates: Partial<Overlay>,
  ) {
    if (!userContributionsLoaded.value) return;
    const overlay = userContributionOverlays.value[projectId]?.find(
      (item) => item.id === overlayId,
    );
    if (overlay) Object.assign(overlay, updates);
  }

  function removeOverlayFromUserContributions(overlayId: string, currentUserId?: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    const entry = Object.entries(userContributionOverlays.value).find(([, overlays]) =>
      overlays.some((overlay) => overlay.id === overlayId),
    );
    if (!entry) return;
    const [projectId, overlays] = entry;
    const remainingOverlays = overlays.filter((overlay) => overlay.id !== overlayId);
    userContributionOverlays.value[projectId] = remainingOverlays;

    const project = projects.value[projectId];
    if (remainingOverlays.length === 0 && project && project.ownerId !== currentUserId) {
      // oxlint-disable-next-line no-dynamic-delete
      delete userContributionOverlays.value[projectId];
    }
  }

  function removeProjectFromUserContributions(projectId: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    // oxlint-disable-next-line no-dynamic-delete
    delete userContributionOverlays.value[projectId];
  }

  // Inserts a project into the store, snapshotting backend-sourced ones (status !== null) as the
  // change-detection baseline. No-op if it is already present.
  function addProject(project: Project) {
    if (projects.value[project.id]) return;
    upsertProjectSummary(project);
  }

  // Updates a project already present in the store.
  function updateProject(projectId: string, updates: Partial<Project>) {
    const current = projects.value[projectId];

    // Cache original before first modification for reset / change-detection.
    if (current && current.status !== null && !current.isModified) {
      snapshotOriginal(current);
    }

    if (!current) return;
    projects.value[projectId] = { ...current, ...updates };
  }

  // Overwrites the change-detection baseline with the project's current state, which callers
  // guarantee to match the backend.
  function cacheProjectBackendState(projectId: string) {
    const project = projects.value[projectId];
    if (project) {
      originalProjects.value[projectId] = { ...project };
    }
  }

  // Resets a single project field to its original backend value.
  // oxlint-disable-next-line no-unnecessary-type-parameters
  function resetProjectField<K extends keyof Project>(projectId: string, fieldName: K): boolean {
    const original = getOriginalProject(projectId);

    if (!original) {
      return false;
    }

    const originalValue = original[fieldName];

    if (originalValue === undefined || !projects.value[projectId]) {
      return false;
    }

    updateProject(projectId, { [fieldName]: originalValue });
    return true;
  }

  // Clear user-specific state on logout or account switch.
  function clearAllState(): void {
    projects.value = {};
    userContributionOverlays.value = {};
    userContributionsLoading.value = false;
    userContributionsLoaded.value = false;
    originalProjects.value = {};
  }

  return {
    projects,
    userContributionOverlays,
    userContributionsLoading,
    userContributionsLoaded,

    // Local project actions
    addProject,
    upsertProjectSummary,
    upsertHydratedProject,
    adoptBackendProjectSummary,
    removeProject,
    updateProject,
    cacheProjectBackendState,
    resetProjectField,
    getOriginalProject,
    getProjectById,
    getMapProjectById,
    getHydratedProject,

    // User contributions actions
    setUserContributions,
    setUserContributionsLoading,
    addOverlayToUserContributions,
    addRenderToUserContributions,
    addProjectToUserContributions,
    updateOverlayInUserContributions,
    removeOverlayFromUserContributions,
    removeProjectFromUserContributions,

    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}
