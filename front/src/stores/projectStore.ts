import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import type {
  Project,
  ProjectDetailFields,
  HydratedProject,
  OverlayObject,
  Overlay,
  ContributionProject,
} from "@/types/index";
import type { ApprovalStatus } from "@shared/types";
import {
  createProjectObject,
  createLocalOverlayContribution,
  getProjectDetailFields,
} from "@/utils/typeFactories";

// Strips the inline overlay list off a contribution so only Project data lands in the project map.
function toProject(contribution: Project): Project {
  const { overlays: _overlays, ...project } = contribution;
  return project;
}

export const useProjectStore = defineStore("project", () => {
  // Single source of truth for project data. Contribution projects live here too; the
  // contribution list is membership (contributionIds) projected over this map.
  const projects = ref<Record<string, Project>>({});
  const hydratedProjectIds = ref<Record<string, true>>({});

  // Membership: ids of projects the user has contributed to.
  const contributionIds = ref<Record<string, true>>({});
  // Contribution overlay metadata, keyed by overlay id. Separate from overlayStore.liveOverlays,
  // which holds live map-rendered overlays (corners/history/image), not list metadata.
  const contributionOverlays = ref<Record<string, Overlay>>({});
  const userContributionsLoading = ref(false);
  const userContributionsLoaded = ref(false);

  // Snapshots of projects before local modifications (for change detection / reset)
  const originalProjects = ref<Record<string, Project>>({});

  // Groups contribution overlays by project id, preserving insertion order.
  function overlaysByProjectId(): Record<string, Overlay[]> {
    const grouped: Record<string, Overlay[]> = {};
    for (const overlay of Object.values(contributionOverlays.value)) {
      const { projectId } = overlay;
      if (projectId === null) continue;
      (grouped[projectId] ??= []).push(overlay);
    }
    return grouped;
  }

  // Contributions as a Record<id, Project> with overlays attached, rebuilt from the project map +
  // overlay metadata. Read-only projection: mutate the normalized state, not this.
  const userContributions = computed<Record<string, ContributionProject>>(() => {
    const grouped = overlaysByProjectId();
    const result: Record<string, ContributionProject> = {};
    for (const id of Object.keys(contributionIds.value)) {
      const project = projects.value[id];
      if (!project) continue;
      const overlays = grouped[id] ?? [];
      result[id] = { ...project, overlays, overlayIds: overlays.map((o) => o.id) };
    }
    return result;
  });

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

  function getHydratedProject(projectId: string): HydratedProject | null {
    if (!hydratedProjectIds.value[projectId]) return null;
    const project = projects.value[projectId];
    return project ? (project as HydratedProject) : null;
  }

  function upsertProjectSummary(project: Project): Project {
    const current = projects.value[project.id];
    let stored = project;
    if (current && hydratedProjectIds.value[project.id]) {
      stored = {
        ...current,
        ...project,
        ...getProjectDetailFields(current),
      };
    } else if (current) {
      stored = { ...current, ...project };
    }
    projects.value[project.id] = stored;
    if (stored.status !== null) snapshotOriginal(stored);
    return stored;
  }

  function applyProjectDetail(projectId: string, detail: ProjectDetailFields): HydratedProject {
    const current = projects.value[projectId] ?? createProjectObject({ id: projectId });
    const hydrated = { ...current, ...detail } as HydratedProject;
    projects.value[projectId] = hydrated;
    hydratedProjectIds.value[projectId] = true;
    if (hydrated.status !== null) snapshotOriginal(hydrated);
    return hydrated;
  }

  function removeProject(projectId: string): void {
    // oxlint-disable-next-line no-dynamic-delete
    delete projects.value[projectId];
    // oxlint-disable-next-line no-dynamic-delete
    delete hydratedProjectIds.value[projectId];
    // oxlint-disable-next-line no-dynamic-delete
    delete originalProjects.value[projectId];
  }

  function setUserContributions(contributions: Project[]) {
    const ids: Record<string, true> = {};
    const overlays: Record<string, Overlay> = {};
    for (const contribution of contributions) {
      ids[contribution.id] = true;
      const incoming = toProject(contribution);
      // Keep locally edited projects; otherwise adopt the fresher backend payload.
      const existing = projects.value[contribution.id];
      const stored = existing?.isModified ? existing : upsertProjectSummary(incoming);
      snapshotOriginal(stored);
      for (const overlay of contribution.overlays ?? []) {
        overlays[overlay.id] = overlay;
      }
    }
    contributionIds.value = ids;
    contributionOverlays.value = overlays;
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

    if (contributionIds.value[project.id]) {
      contributionOverlays.value[overlayMetadata.id] = overlayMetadata;
      return;
    }

    // Project not yet a contribution. Local (unsubmitted) projects are surfaced by the live merge,
    // not this map, so skip them here.
    if (project.status === null) {
      return;
    }

    contributionIds.value[project.id] = true;
    const stored = (projects.value[project.id] ??= project);
    // Include overlays already in the store for this project (e.g. approved ones)
    for (const existing of existingProjectOverlays) {
      const meta = createLocalOverlayContribution(existing, project, null);
      contributionOverlays.value[meta.id] = meta;
    }
    contributionOverlays.value[overlayMetadata.id] = overlayMetadata;
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
    if (contributionOverlays.value[render.id]) return;

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

    if (contributionIds.value[projectId]) {
      contributionOverlays.value[overlay.id] = overlay;
      return;
    }

    // Render added to a project not yet in My Contributions (e.g. an imported project the user
    // didn't own). The backend lists it as a contribution once authored, so mirror that here.
    if (parent.status === null) return;
    contributionIds.value[projectId] = true;
    contributionOverlays.value[overlay.id] = overlay;
  }

  // Optimistically add new project to user contributions without a backend fetch.
  function addProjectToUserContributions(project: Project) {
    if (!userContributionsLoaded.value) {
      return;
    }

    if (project.status === null) {
      return;
    }

    if (contributionIds.value[project.id]) {
      return;
    }

    contributionIds.value[project.id] = true;
    const stored = (projects.value[project.id] ??= project);
    snapshotOriginal(stored);
  }

  // Update pending overlay in user contributions (for caption/field updates)
  function updateOverlayInUserContributions(overlayId: string, updates: Partial<Overlay>) {
    if (!userContributionsLoaded.value) return;
    const overlay = contributionOverlays.value[overlayId];
    if (overlay) Object.assign(overlay, updates);
  }

  function updateProjectInUserContributions(projectId: string, updates: Partial<Project>) {
    if (!userContributionsLoaded.value) return;
    const project = projects.value[projectId];
    if (project && contributionIds.value[projectId]) Object.assign(project, updates);
  }

  function removeOverlayFromUserContributions(overlayId: string, currentUserId?: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    const overlay = contributionOverlays.value[overlayId];
    if (!overlay) return;

    const { projectId } = overlay;
    // oxlint-disable-next-line no-dynamic-delete
    delete contributionOverlays.value[overlayId];
    if (projectId === null) return;

    const project = projects.value[projectId];
    const hasRemaining = Object.values(contributionOverlays.value).some(
      (o) => o.projectId === projectId,
    );
    if (!hasRemaining && project && project.ownerId !== currentUserId) {
      // oxlint-disable-next-line no-dynamic-delete
      delete contributionIds.value[projectId];
    }
  }

  function removeProjectFromUserContributions(projectId: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    // oxlint-disable-next-line no-dynamic-delete
    delete contributionIds.value[projectId];
    for (const [id, overlay] of Object.entries(contributionOverlays.value)) {
      // oxlint-disable-next-line no-dynamic-delete
      if (overlay.projectId === projectId) delete contributionOverlays.value[id];
    }
  }

  // Inserts a project into the store, snapshotting backend-sourced ones (status !== null) as the
  // change-detection baseline. No-op if it is already present.
  function addProject(project: Project) {
    if (projects.value[project.id]) return;
    upsertProjectSummary(project);
  }

  // Updates a project in the store. Creates it if not present.
  function updateProject(projectId: string, updates: Partial<Project>) {
    const current = projects.value[projectId];

    // Cache original before first modification for reset / change-detection.
    if (current && current.status !== null && !current.isModified) {
      snapshotOriginal(current);
    }

    projects.value[projectId] = current ? { ...current, ...updates } : createProjectObject(updates);
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
    hydratedProjectIds.value = {};
    contributionIds.value = {};
    contributionOverlays.value = {};
    userContributionsLoading.value = false;
    userContributionsLoaded.value = false;
    originalProjects.value = {};
  }

  return {
    projects,
    userContributions,
    userContributionsLoading,
    userContributionsLoaded,

    // Local project actions
    addProject,
    upsertProjectSummary,
    applyProjectDetail,
    removeProject,
    updateProject,
    cacheProjectBackendState,
    resetProjectField,
    getOriginalProject,
    getProjectById,
    getHydratedProject,

    // User contributions actions
    setUserContributions,
    setUserContributionsLoading,
    addOverlayToUserContributions,
    addRenderToUserContributions,
    addProjectToUserContributions,
    updateOverlayInUserContributions,
    updateProjectInUserContributions,
    removeOverlayFromUserContributions,
    removeProjectFromUserContributions,

    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}
