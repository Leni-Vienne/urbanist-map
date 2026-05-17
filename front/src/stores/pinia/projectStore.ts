import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type {
  Project,
  Country,
  OverlayObject,
  UserContribution,
  UserContributionOverlay,
} from "@/types/index";
import { createProjectObject } from "@/utils/typeFactories";
import { createLocalOverlayContribution } from "@/utils/projectFactories";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

function replaceAtIndex<T>(arr: T[], index: number, newItem: T): T[] {
  return [...arr.slice(0, index), newItem, ...arr.slice(index + 1)];
}

function removeAtIndex<T>(arr: T[], index: number): T[] {
  return [...arr.slice(0, index), ...arr.slice(index + 1)];
}

export const useProjectStore = defineStore("project", () => {
  const projects = ref<Record<string, Project>>({});
  const countries = ref<Country[]>([]);

  const userContributions = ref<UserContribution[]>([]);
  const userContributionsLoading = ref(false);
  const userContributionsLoaded = ref(false);

  // Snapshots of projects before local modifications (for change detection / reset)
  const originalProjects = ref<Record<string, Project>>({});

  // cityId -> city name, populated lazily from forms and backend responses
  const cityNamesCache = ref<Record<number, string>>({});

  function cacheCityName(cityId: number, cityName: string) {
    cityNamesCache.value = {
      ...cityNamesCache.value,
      [cityId]: cityName,
    };
  }

  function getOriginalProject(projectId: string): Project | null {
    return originalProjects.value[projectId] ?? null;
  }

  // Promote a Project to a UserContribution by attaching the inline overlay list and joined country name.
  // overlayIds is derived from overlays so the two stay in sync.
  function toContribution(project: Project, overlays: UserContributionOverlay[]): UserContribution {
    const country = countries.value.find((c) => c.code === project.countryCode);
    return {
      ...project,
      overlays,
      overlayIds: overlays.map((o) => o.id),
      cityName: project.city?.name ?? null,
      countryName: country?.name ?? null,
    };
  }

  function overlayParentMetadata(project: Project) {
    const country = countries.value.find((c) => c.code === project.countryCode);
    return {
      cityId: project.cityId,
      cityName: project.city?.name ?? null,
      countryCode: project.countryCode,
      countryName: country?.name ?? null,
    };
  }

  function setUserContributions(contributions: UserContribution[]) {
    userContributions.value = contributions;
    userContributionsLoaded.value = true;

    for (const contribution of contributions) {
      if (!originalProjects.value[contribution.id]) {
        originalProjects.value = {
          ...originalProjects.value,
          [contribution.id]: { ...contribution },
        };
      }
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

      const updatedProject = {
        ...existingProject,
        overlays: updatedOverlays,
        overlayIds: updatedOverlays.map((o) => o.id),
      };

      userContributions.value = replaceAtIndex(
        userContributions.value,
        existingProjectIndex,
        updatedProject,
      );

      if (existingOverlayIndex === -1 && !originalProjects.value[project.id]) {
        originalProjects.value = {
          ...originalProjects.value,
          [project.id]: { ...updatedProject },
        };
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

      if (!originalProjects.value[project.id]) {
        originalProjects.value = {
          ...originalProjects.value,
          [project.id]: { ...newProject },
        };
      }
    }
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

    if (!originalProjects.value[project.id]) {
      originalProjects.value = {
        ...originalProjects.value,
        [project.id]: { ...newContrib },
      };
    }
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
    if (!userContributionsLoaded.value) {
      return;
    }

    const found = findProjectContainingOverlay(overlayId);
    if (!found) return;

    const { index: projectIndex, project } = found;
    const overlayIndex = project.overlays.findIndex((o) => o.id === overlayId);

    if (overlayIndex !== -1) {
      const overlay = project.overlays[overlayIndex];
      if (!overlay) return;

      const updatedOverlays = replaceAtIndex(project.overlays, overlayIndex, {
        ...overlay,
        ...updates,
      });
      const updatedProject = {
        ...project,
        overlays: updatedOverlays,
        overlayIds: updatedOverlays.map((o) => o.id),
      };
      userContributions.value = replaceAtIndex(
        userContributions.value,
        projectIndex,
        updatedProject,
      );
    }
  }

  function updateProjectInUserContributions(projectId: string, updates: Partial<UserContribution>) {
    if (!userContributionsLoaded.value) {
      return;
    }

    const projectIndex = userContributions.value.findIndex((p) => p.id === projectId);
    if (projectIndex !== -1) {
      const project = userContributions.value[projectIndex];
      if (!project) return;

      const updatedProject = { ...project, ...updates };
      userContributions.value = replaceAtIndex(
        userContributions.value,
        projectIndex,
        updatedProject,
      );
    }
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
      const updatedProject = {
        ...project,
        overlays: updatedOverlays,
        overlayIds: updatedOverlays.map((o) => o.id),
      };
      userContributions.value = replaceAtIndex(
        userContributions.value,
        projectIndex,
        updatedProject,
      );
    }
  }

  function removeProjectFromUserContributions(projectId: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    userContributions.value = userContributions.value.filter((p) => p.id !== projectId);
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
    if (
      current &&
      !originalProjects.value[projectId] &&
      current.status !== null &&
      !current.isModified
    ) {
      originalProjects.value = {
        ...originalProjects.value,
        [projectId]: { ...current },
      };
    }

    projects.value = {
      ...projects.value,
      [projectId]: current ? { ...current, ...updates } : createProjectObject(updates),
    };
  }

  // Stores the current project state as baseline for future change detection.
  function cacheProjectBackendState(projectId: string) {
    const project = projects.value[projectId];

    if (project && !originalProjects.value[projectId]) {
      originalProjects.value = {
        ...originalProjects.value,
        [projectId]: { ...project },
      };
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
    cityNamesCache.value = {};
  }

  return {
    // State
    projects,
    userContributions,
    userContributionsLoading,
    userContributionsLoaded,
    cityNamesCache,

    // Local project actions
    updateProject,
    cacheProjectBackendState,
    resetProjectField,
    cacheCityName,
    getOriginalProject,
    // User contributions actions
    setUserContributions,
    setUserContributionsLoading,
    addOverlayToUserContributions,
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
