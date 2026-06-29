import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type {
  Project,
  OverlayObject,
  UserContribution,
  UserContributionOverlay,
} from "@/types/index";
import type { ApprovalStatus } from "@shared/types";
import { createProjectObject } from "@/utils/typeFactories";
import { createLocalOverlayContribution } from "@/utils/projectFactories";

// Promote a Project to a UserContribution by attaching the inline overlay list.
// overlayIds is derived from overlays so the two stay in sync.
function toContribution(project: Project, overlays: UserContributionOverlay[]): UserContribution {
  return {
    ...project,
    overlays,
    overlayIds: overlays.map((o) => o.id),
  };
}

export const useProjectStore = defineStore("project", () => {
  const projects = ref<Record<string, Project>>({});

  const userContributions = ref<Record<string, UserContribution>>({});
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

  // Pending projects may live only in userContributions until edited locally, so fall
  // back to that list when the project isn't in the main map.
  function getProjectById(projectId: string): Project | null {
    return projects.value[projectId] ?? userContributions.value[projectId] ?? null;
  }

  // Find a loaded contribution by predicate and mutate it in place.
  // No-op (returns false) if contributions aren't loaded yet or nothing matches.
  function mutateContribution(
    predicate: (p: UserContribution) => boolean,
    mutator: (p: UserContribution) => void,
  ): boolean {
    if (!userContributionsLoaded.value) return false;
    const current = Object.values(userContributions.value).find(predicate);
    if (!current) return false;
    mutator(current);
    return true;
  }

  function setUserContributions(contributions: UserContribution[]) {
    const newContributions: Record<string, UserContribution> = {};
    for (const contribution of contributions) {
      newContributions[contribution.id] = contribution;
      snapshotOriginal(contribution);
    }
    userContributions.value = newContributions;
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

    const existingProject = userContributions.value[project.id];
    const overlayMetadata = createLocalOverlayContribution(
      { ...overlay, filename, projectId: project.id, status: "pending" as const, version: 1 },
      project,
      authorUsername,
    );

    if (existingProject) {
      const existingOverlayIndex = existingProject.overlays.findIndex((o) => o.id === overlay.id);

      if (existingOverlayIndex !== -1) {
        existingProject.overlays[existingOverlayIndex] = overlayMetadata;
      } else {
        existingProject.overlays.push(overlayMetadata);
        existingProject.overlayIds.push(overlayMetadata.id);
      }

      if (existingOverlayIndex === -1) {
        snapshotOriginal(existingProject);
      }
    } else {
      // Project doesn't exist in contributions yet
      if (project.status === null) {
        return;
      }

      // Include overlays already in the store for this project (e.g. approved ones)
      const mappedExistingOverlays = existingProjectOverlays.map((o) =>
        createLocalOverlayContribution(o, project, null),
      );

      const newProject = toContribution(project, [...mappedExistingOverlays, overlayMetadata]);

      userContributions.value[newProject.id] = newProject;

      snapshotOriginal(newProject);
    }
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

    const existing = userContributions.value[projectId];
    if (existing?.overlays.some((o) => o.id === render.id)) return;

    // We can use the parent directly because it contains countryCode and countryName
    const parent = existing ?? projects.value[projectId];
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

    if (existing) {
      existing.overlays.push(overlay);
      existing.overlayIds.push(overlay.id);
      return;
    }

    // Render added to a project not yet in My Contributions (e.g. an imported project the user
    // didn't own). The backend lists it as a contribution once authored, so mirror that here.
    const project = projects.value[projectId];
    if (!project || project.status === null) return;

    const newContrib = toContribution(project, [overlay]);
    userContributions.value[newContrib.id] = newContrib;
  }

  // Optimistically add new project to user contributions without a backend fetch.
  function addProjectToUserContributions(project: Project) {
    if (!userContributionsLoaded.value) {
      return;
    }

    if (project.status === null) {
      return;
    }

    if (userContributions.value[project.id]) {
      return;
    }

    const newContrib = toContribution(project, []);

    userContributions.value[newContrib.id] = newContrib;

    snapshotOriginal(newContrib);
  }

  // Returns the project + its index from userContributions, or null if not found.
  function findProjectContainingOverlay(overlayId: string): { project: UserContribution } | null {
    const project = Object.values(userContributions.value).find((p) =>
      p.overlays.some((o) => o.id === overlayId),
    );
    if (!project) return null;
    return { project };
  }

  // Update pending overlay in user contributions (for caption/field updates)
  function updateOverlayInUserContributions(
    overlayId: string,
    updates: Partial<UserContributionOverlay>,
  ) {
    mutateContribution(
      (p) => p.overlays.some((o) => o.id === overlayId),
      (p) => {
        const overlay = p.overlays.find((o) => o.id === overlayId);
        if (overlay) {
          Object.assign(overlay, updates);
        }
      },
    );
  }

  function updateProjectInUserContributions(projectId: string, updates: Partial<UserContribution>) {
    mutateContribution(
      (p) => p.id === projectId,
      (p) => {
        Object.assign(p, updates);
      },
    );
  }

  // currentUserId avoids circular dependency with authStore.
  function removeOverlayFromUserContributions(overlayId: string, currentUserId?: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    const found = findProjectContainingOverlay(overlayId);
    if (!found) return;

    const { project } = found;

    const overlayIndex = project.overlays.findIndex((o) => o.id === overlayId);
    if (overlayIndex !== -1) {
      project.overlays.splice(overlayIndex, 1);
      project.overlayIds.splice(overlayIndex, 1);
    }

    if (project.overlays.length === 0 && project.ownerId !== currentUserId) {
      // oxlint-disable-next-line no-dynamic-delete
      delete userContributions.value[project.id];
    }
  }

  function removeProjectFromUserContributions(projectId: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    // oxlint-disable-next-line no-dynamic-delete
    delete userContributions.value[projectId];
  }

  // Inserts a backend-sourced project into the store, snapshotting it as the change-detection
  // baseline. No-op if it is already present.
  function addProject(project: Project) {
    if (projects.value[project.id]) return;
    projects.value[project.id] = project;
    if (project.status !== null) snapshotOriginal(project);
  }

  // Updates a project in the store. Creates it if not present.
  function updateProject(projectId: string, updates: Partial<Project>) {
    let current = projects.value[projectId];

    // Pending projects may only exist in userContributions until edited locally.
    // Since UserContribution extends Project, we can use the contribution directly as a Project.
    if (!current) {
      const contributionProject = userContributions.value[projectId];
      if (contributionProject) {
        current = contributionProject;
      }
    }

    // Cache original before first modification for reset / change-detection.
    if (current && current.status !== null && !current.isModified) {
      snapshotOriginal(current);
    }

    projects.value[projectId] = current ? { ...current, ...updates } : createProjectObject(updates);
  }

  // Stores the current project state as baseline for future change detection.
  function cacheProjectBackendState(projectId: string) {
    const project = projects.value[projectId];
    if (project) {
      snapshotOriginal(project);
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

    let didReset = false;

    const current = projects.value[projectId];
    if (current && originalValue !== undefined) {
      updateProject(projectId, { [fieldName]: originalValue });
      didReset = true;
    }

    // Also update user contributions if present (critical for ContributePanel)
    const contrib = userContributions.value[projectId];
    if (contrib && originalValue !== undefined) {
      (contrib as Project)[fieldName] = originalValue;
      didReset = true;
    }

    return didReset;
  }

  // Clear user-specific state on logout or account switch.
  function clearAllState(): void {
    projects.value = {};
    userContributions.value = {};
    userContributionsLoading.value = false;
    userContributionsLoaded.value = false;
    originalProjects.value = {};
  }

  return {
    // State
    projects,
    userContributions,
    userContributionsLoading,
    userContributionsLoaded,

    // Local project actions
    addProject,
    updateProject,
    cacheProjectBackendState,
    resetProjectField,
    getOriginalProject,
    getProjectById,
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

    // Comprehensive cleanup
    clearAllState,
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}
