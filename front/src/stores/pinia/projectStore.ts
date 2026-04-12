import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type {
  Project,
  Country,
  OverlayObject,
  UserContribution,
  UserContributionOverlay,
} from "@/types/index";
import type { AppMode } from "@shared/types";
import { createProjectObject, createProjectFromUserContribution } from "@/utils/typeFactories";
import { createLocalOverlayContribution } from "@/utils/projectFactories";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

// Replaces an item in an array immutably.
function replaceAtIndex<T>(arr: T[], index: number, newItem: T): T[] {
  return [...arr.slice(0, index), newItem, ...arr.slice(index + 1)];
}

// Removes an item from an array immutably.
function removeAtIndex<T>(arr: T[], index: number): T[] {
  return [...arr.slice(0, index), ...arr.slice(index + 1)];
}

// Cache key for getUserContributions (exported for composable use).
function getUserContributionsCacheKey(options?: {
  cityId?: number;
  includeCityProjects?: boolean;
}): string {
  const cityId = options?.cityId ?? null;
  const includeCityProjects = options?.includeCityProjects ?? false;
  return `${cityId}:${includeCityProjects}`;
}

export const useProjectStore = defineStore("project", () => {
  const projects = ref<Record<string, Project>>({});
  const selectedProjectId = ref<string | null>(null);
  const countries = ref<Country[]>([]);

  const countriesCache = ref(new Map<AppMode, Country[]>());

  const userContributions = ref<UserContribution[]>([]);
  const userContributionsLoading = ref(false);
  // "cityId:includeCityProjects" (e.g. "null:false", "3029241:true")
  const userContributionsCache = ref(new Map<string, UserContribution[]>());

  // Snapshots of projects before local modifications (for change detection / reset)
  const originalProjects = ref<Record<string, Project | UserContribution>>({});

  // cityId -> city name, populated lazily from forms and backend responses
  const cityNamesCache = ref<Record<number, string>>({});

  function cacheCityName(cityId: number, cityName: string) {
    cityNamesCache.value = {
      ...cityNamesCache.value,
      [cityId]: cityName,
    };
  }

  function getOriginalProject(projectId: string): Project | UserContribution | null {
    return originalProjects.value[projectId] ?? null;
  }

  function extractCityMetadata(project: Project) {
    const country = countries.value.find((c) => c.code === project.countryCode);
    return {
      cityName: project.city?.name ?? null,
      countryCode: project.countryCode,
      countryName: country?.name ?? null,
    };
  }

  function setUserContributions(contributions: UserContribution[], cacheKey: string) {
    userContributions.value = contributions;
    userContributionsCache.value.set(cacheKey, contributions);

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
    if (userContributionsCache.value.size === 0) {
      return;
    }

    const existingProjectIndex = userContributions.value.findIndex((p) => p.id === project.id);

    if (existingProjectIndex !== -1) {
      const existingProject = userContributions.value[existingProjectIndex];

      if (!existingProject) {
        console.error("Existing project not found for ID:", project.id);
        return;
      }

      const existingOverlayIndex = existingProject.overlays.findIndex((o) => o.id === overlay.id);

      const overlayMetadata = createLocalOverlayContribution(
        { ...overlay, filename, projectId: project.id, status: "pending" as const, version: 1 },
        { cityId: project.cityId, ...extractCityMetadata(project) },
        authorUsername,
      );

      const updatedOverlays =
        existingOverlayIndex !== -1
          ? replaceAtIndex(existingProject.overlays, existingOverlayIndex, overlayMetadata)
          : [...existingProject.overlays, overlayMetadata];

      const newOverlayCount = existingProject.overlayCount + (existingOverlayIndex === -1 ? 1 : 0);

      const updatedProject = {
        ...existingProject,
        overlays: updatedOverlays,
        overlayCount: newOverlayCount,
      };

      userContributions.value = replaceAtIndex(
        userContributions.value,
        existingProjectIndex,
        updatedProject,
      );

      // Cache the original project state with overlay for change detection
      // Only cache if this is a new overlay (not replacing an existing one)
      if (existingOverlayIndex === -1 && !originalProjects.value[project.id]) {
        originalProjects.value = {
          ...originalProjects.value,
          [project.id]: { ...updatedProject } as UserContribution,
        };
      }
    } else {
      // Project doesn't exist in contributions yet
      if (project.status === null) {
        return;
      }

      // Include overlays already in the store for this project (e.g. approved ones)
      const overlayStore = useOverlayStore();
      const cityMeta = extractCityMetadata(project);
      const existingOverlays = Object.values(overlayStore.overlays)
        .filter((o) => o.projectId === project.id && o.id !== overlay.id)
        .map((o) =>
          createLocalOverlayContribution(o, { ...cityMeta, cityId: project.cityId }, null),
        );
      const newOverlayMetadata = createLocalOverlayContribution(
        { ...overlay, filename, projectId: project.id, status: "pending" as const, version: 1 },
        { cityId: project.cityId, ...extractCityMetadata(project) },
        authorUsername,
      );

      const newProject = {
        ...project,
        ...extractCityMetadata(project),
        status: project.status, // Type assertion - null already filtered above
        overlays: [...existingOverlays, newOverlayMetadata],
        overlayCount: existingOverlays.length + 1,
      };

      userContributions.value = [newProject, ...userContributions.value];

      // Cache the original project state for change detection
      if (!originalProjects.value[project.id]) {
        originalProjects.value = {
          ...originalProjects.value,
          [project.id]: { ...newProject } as UserContribution,
        };
      }
    }
  }

  // Optimistically add new project to user contributions without a backend fetch.
  function addProjectToUserContributions(project: Project) {
    if (userContributionsCache.value.size === 0) {
      return;
    }

    if (project.status === null) {
      return;
    }

    const existingIndex = userContributions.value.findIndex((p) => p.id === project.id);
    if (existingIndex !== -1) {
      return;
    }

    const newContrib = {
      ...project,
      ...extractCityMetadata(project),
      status: project.status, // Type assertion - null already filtered above
      overlays: [],
      overlayCount: 0,
    };

    userContributions.value = [newContrib, ...userContributions.value];

    if (!originalProjects.value[project.id]) {
      originalProjects.value = {
        ...originalProjects.value,
        [project.id]: { ...newContrib } as UserContribution,
      };
    }
  }

  // Returns the project + its index from userContributions, or null if not found.
  function findProjectContainingOverlay(
    overlayId: string,
  ): { index: number; project: UserContribution } | null {
    const index = userContributions.value.findIndex((p) =>
      p.overlays.some((o: UserContributionOverlay) => o.id === overlayId),
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
    if (userContributionsCache.value.size === 0) {
      return;
    }

    const found = findProjectContainingOverlay(overlayId);
    if (!found) return;

    const { index: projectIndex, project } = found;
    const overlayIndex = project.overlays.findIndex(
      (o: UserContributionOverlay) => o.id === overlayId,
    );

    if (overlayIndex !== -1) {
      const overlay = project.overlays[overlayIndex];
      if (!overlay) return;

      const updatedOverlays = replaceAtIndex(project.overlays, overlayIndex, {
        ...overlay,
        ...updates,
      });
      const updatedProject = { ...project, overlays: updatedOverlays };
      userContributions.value = replaceAtIndex(
        userContributions.value,
        projectIndex,
        updatedProject,
      );
    }
  }

  function updateProjectInUserContributions(projectId: string, updates: Partial<UserContribution>) {
    if (userContributionsCache.value.size === 0) {
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
    if (userContributionsCache.value.size === 0) {
      return;
    }

    const found = findProjectContainingOverlay(overlayId);
    if (!found) return;

    const { index: projectIndex, project } = found;
    const updatedOverlays = project.overlays.filter(
      (o: UserContributionOverlay) => o.id !== overlayId,
    );

    // If no overlays left and user doesn't own project, remove entire project
    if (updatedOverlays.length === 0 && project.ownerId !== currentUserId) {
      userContributions.value = removeAtIndex(userContributions.value, projectIndex);
    } else {
      // Update project with remaining overlays
      const updatedProject = {
        ...project,
        overlays: updatedOverlays,
        overlayCount: updatedOverlays.length,
      };
      userContributions.value = replaceAtIndex(
        userContributions.value,
        projectIndex,
        updatedProject,
      );
    }
  }

  function removeProjectFromUserContributions(projectId: string) {
    if (userContributionsCache.value.size === 0) {
      return;
    }

    userContributions.value = userContributions.value.filter((p) => p.id !== projectId);
  }

  // Updates a project in the store. Creates it if not present.
  function updateProject(projectId: string, updates: Partial<Project>) {
    let current = projects.value[projectId];

    // Pending projects may only exist in userContributions until edited locally.
    if (!current) {
      const contributionProject = userContributions.value.find(
        (project) => project.id === projectId,
      );
      if (contributionProject) {
        current = createProjectFromUserContribution(contributionProject);
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
    const originalValue = (original as Record<string, unknown>)[fieldName];

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

  function getCachedCountries(mode: AppMode): Country[] | null {
    return countriesCache.value.get(mode) ?? null;
  }

  function setCachedCountries(mode: AppMode, countriesData: Country[]): void {
    countriesCache.value.set(mode, countriesData);
  }

  function hasCachedCountries(mode: AppMode): boolean {
    return countriesCache.value.has(mode);
  }

  function clearCountriesCache(): void {
    countriesCache.value.clear();
  }

  // Clear user-specific state on logout or account switch.
  function clearAllState(): void {
    projects.value = {};
    selectedProjectId.value = null;

    userContributions.value = [];
    userContributionsLoading.value = false;
    userContributionsCache.value.clear();
    originalProjects.value = {};
    cityNamesCache.value = {};
    clearCountriesCache();
  }

  return {
    // State
    projects,
    selectedProjectId,
    countries,
    userContributions,
    userContributionsLoading,
    userContributionsCache,
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
    getUserContributionsCacheKey,
    addOverlayToUserContributions,
    addProjectToUserContributions,
    updateOverlayInUserContributions,
    updateProjectInUserContributions,
    removeOverlayFromUserContributions,
    removeProjectFromUserContributions,

    // Countries cache actions
    getCachedCountries,
    setCachedCountries,
    hasCachedCountries,

    // Comprehensive cleanup
    clearAllState,
  };
});

// Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}
