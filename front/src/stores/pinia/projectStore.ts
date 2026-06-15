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
import { clearCityNameCache } from "@/utils/cityNameCache";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

function replaceAtIndex<T>(arr: T[], index: number, newItem: T): T[] {
  return [...arr.slice(0, index), newItem, ...arr.slice(index + 1)];
}

function removeAtIndex<T>(arr: T[], index: number): T[] {
  return [...arr.slice(0, index), ...arr.slice(index + 1)];
}

// Rebuild a contribution with a new overlay list, keeping overlayIds in sync.
function withOverlays(
  contribution: UserContribution,
  overlays: UserContributionOverlay[],
): UserContribution {
  return { ...contribution, overlays, overlayIds: overlays.map((o) => o.id) };
}

// Denormalized fields win; the joined city lookup is a fallback when cityName is unset.
function resolveLocationNames(project: Project): {
  cityName: string | null;
  countryName: string | null;
} {
  return {
    cityName: project.cityName ?? project.city?.name ?? null,
    countryName: project.countryName ?? null,
  };
}

export const useProjectStore = defineStore("project", () => {
  const projects = ref<Record<string, Project>>({});

  const userContributions = ref<UserContribution[]>([]);
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
    return (
      projects.value[projectId] ?? userContributions.value.find((p) => p.id === projectId) ?? null
    );
  }

  // Promote a Project to a UserContribution by attaching the inline overlay list.
  // overlayIds is derived from overlays so the two stay in sync.
  function toContribution(project: Project, overlays: UserContributionOverlay[]): UserContribution {
    return {
      ...project,
      overlays,
      overlayIds: overlays.map((o) => o.id),
      ...resolveLocationNames(project),
    };
  }

  function overlayParentMetadata(project: Project) {
    return {
      cityId: project.cityId,
      countryCode: project.countryCode,
      ...resolveLocationNames(project),
    };
  }

  // Find a loaded contribution by predicate and write back an updated copy.
  // No-op (returns false) if contributions aren't loaded yet or nothing matches.
  function replaceContribution(
    predicate: (p: UserContribution) => boolean,
    updater: (p: UserContribution) => UserContribution,
  ): boolean {
    if (!userContributionsLoaded.value) return false;
    const index = userContributions.value.findIndex(predicate);
    const current = index === -1 ? undefined : userContributions.value[index];
    if (!current) return false;
    userContributions.value = replaceAtIndex(userContributions.value, index, updater(current));
    return true;
  }

  function setUserContributions(contributions: UserContribution[]) {
    userContributions.value = contributions;
    userContributionsLoaded.value = true;

    for (const contribution of contributions) {
      snapshotOriginal(contribution);
    }
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
  ) {
    if (!userContributionsLoaded.value) {
      return;
    }

    const existingProjectIndex = userContributions.value.findIndex((p) => p.id === project.id);
    const overlayMetadata = createLocalOverlayContribution(
      { ...overlay, filename, projectId: project.id, status: "pending" as const, version: 1 },
      overlayParentMetadata(project),
      authorUsername,
    );

    if (existingProjectIndex !== -1) {
      const existingProject = userContributions.value[existingProjectIndex];

      if (!existingProject) {
        console.error("Existing project not found for ID:", project.id);
        return;
      }

      const existingOverlayIndex = existingProject.overlays.findIndex((o) => o.id === overlay.id);
      const updatedOverlays =
        existingOverlayIndex !== -1
          ? replaceAtIndex(existingProject.overlays, existingOverlayIndex, overlayMetadata)
          : [...existingProject.overlays, overlayMetadata];

      const updatedProject = withOverlays(existingProject, updatedOverlays);

      userContributions.value = replaceAtIndex(
        userContributions.value,
        existingProjectIndex,
        updatedProject,
      );

      if (existingOverlayIndex === -1) {
        snapshotOriginal(updatedProject);
      }
    } else {
      // Project doesn't exist in contributions yet
      if (project.status === null) {
        return;
      }

      // Include overlays already in the store for this project (e.g. approved ones)
      const overlayStore = useOverlayStore();
      const parentMeta = overlayParentMetadata(project);
      const existingOverlays = Object.values(overlayStore.overlays)
        .filter((o) => o.projectId === project.id && o.id !== overlay.id)
        .map((o) => createLocalOverlayContribution(o, parentMeta, null));

      const newProject = toContribution(project, [...existingOverlays, overlayMetadata]);

      userContributions.value = [newProject, ...userContributions.value];

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

    const index = userContributions.value.findIndex((p) => p.id === projectId);
    const existing = index === -1 ? undefined : userContributions.value[index];
    if (existing?.overlays.some((o) => o.id === render.id)) return;

    // overlayParentMetadata reads location fields shared by Project and UserContribution.
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
      overlayParentMetadata(parent),
      authorUsername,
      "render",
    );

    if (existing) {
      userContributions.value = replaceAtIndex(
        userContributions.value,
        index,
        withOverlays(existing, [...existing.overlays, overlay]),
      );
      return;
    }

    // Render added to a project not yet in My Contributions (e.g. an imported project the user
    // didn't own). The backend lists it as a contribution once authored, so mirror that here.
    const project = projects.value[projectId];
    if (!project || project.status === null) return;
    userContributions.value = [toContribution(project, [overlay]), ...userContributions.value];
  }

  // Optimistically add new project to user contributions without a backend fetch.
  function addProjectToUserContributions(project: Project) {
    if (!userContributionsLoaded.value) {
      return;
    }

    if (project.status === null) {
      return;
    }

    const existingIndex = userContributions.value.findIndex((p) => p.id === project.id);
    if (existingIndex !== -1) {
      return;
    }

    const newContrib = toContribution(project, []);

    userContributions.value = [newContrib, ...userContributions.value];

    snapshotOriginal(newContrib);
  }

  // Returns the project + its index from userContributions, or null if not found.
  function findProjectContainingOverlay(
    overlayId: string,
  ): { index: number; project: UserContribution } | null {
    const index = userContributions.value.findIndex((p) =>
      p.overlays.some((o) => o.id === overlayId),
    );
    if (index === -1) return null;
    const project = userContributions.value[index];
    if (!project) {
      console.error("Existing project not found for index:", index);
      return null;
    }
    return { index, project };
  }

  // Update pending overlay in user contributions (for caption/field updates)
  function updateOverlayInUserContributions(
    overlayId: string,
    updates: Partial<UserContributionOverlay>,
  ) {
    replaceContribution(
      (p) => p.overlays.some((o) => o.id === overlayId),
      (p) =>
        withOverlays(
          p,
          p.overlays.map((o) => (o.id === overlayId ? { ...o, ...updates } : o)),
        ),
    );
  }

  function updateProjectInUserContributions(projectId: string, updates: Partial<UserContribution>) {
    replaceContribution(
      (p) => p.id === projectId,
      (p) => ({ ...p, ...updates }),
    );
  }

  // currentUserId avoids circular dependency with authStore.
  function removeOverlayFromUserContributions(overlayId: string, currentUserId?: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    const found = findProjectContainingOverlay(overlayId);
    if (!found) return;

    const { index: projectIndex, project } = found;
    const updatedOverlays = project.overlays.filter((o) => o.id !== overlayId);

    if (updatedOverlays.length === 0 && project.ownerId !== currentUserId) {
      userContributions.value = removeAtIndex(userContributions.value, projectIndex);
    } else {
      userContributions.value = replaceAtIndex(
        userContributions.value,
        projectIndex,
        withOverlays(project, updatedOverlays),
      );
    }
  }

  function removeProjectFromUserContributions(projectId: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    userContributions.value = userContributions.value.filter((p) => p.id !== projectId);
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
      const contributionProject = userContributions.value.find(
        (project) => project.id === projectId,
      );
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
  function resetProjectField(projectId: string, fieldName: string): boolean {
    const original = getOriginalProject(projectId);

    if (!original) {
      return false;
    }

    // oxlint-disable-next-line no-unsafe-type-assertion
    const originalValue = (original as unknown as Record<string, unknown>)[fieldName];

    let didReset = false;

    const current = projects.value[projectId];
    if (current && originalValue !== undefined) {
      updateProject(projectId, { [fieldName]: originalValue });
      didReset = true;
    }

    // Also update user contributions if present (critical for ContributePanel)
    const contribIndex = userContributions.value.findIndex((p) => p.id === projectId);
    if (contribIndex !== -1 && originalValue !== undefined) {
      const contrib = userContributions.value[contribIndex];

      if (contrib) {
        const updatedContrib = { ...contrib, [fieldName]: originalValue };
        userContributions.value = replaceAtIndex(
          userContributions.value,
          contribIndex,
          updatedContrib,
        );
        didReset = true;
      }
    }

    return didReset;
  }

  // Clear user-specific state on logout or account switch.
  function clearAllState(): void {
    projects.value = {};
    userContributions.value = [];
    userContributionsLoading.value = false;
    userContributionsLoaded.value = false;
    originalProjects.value = {};
    clearCityNameCache();
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

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}
