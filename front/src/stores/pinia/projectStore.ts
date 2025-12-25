import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Project, Country, OverlayObject, NearbyProject } from "@/types/index";
import type { MapMode } from "@shared/types";
import { trpc, type RouterOutput } from "@/client";
import { createProjectObjectFromAPI } from "../../utils/typeFactories";

// AI : Type for user contributions from backend
type UserContribution = RouterOutput["project"]["getUsersContributions"]["projects"][number];
type UserContributionOverlay = UserContribution["overlays"][number];

// AI : Helper function to replace an item in an array immutably at a given index
function replaceAtIndex<T>(arr: T[], index: number, newItem: T): T[] {
  return [...arr.slice(0, index), newItem, ...arr.slice(index + 1)];
}

// AI : Helper function to remove an item from an array immutably at a given index
function removeAtIndex<T>(arr: T[], index: number): T[] {
  return [...arr.slice(0, index), ...arr.slice(index + 1)];
}

// AI : Helper functions moved inside store to access state

// AI : Helper functions moved inside store to access state

// AI : Cities cache management (separate cache per mode)
function getCitiesCacheKey(countryCode: string, mode: MapMode): string {
  return `${countryCode}:${mode}`;
}

export const useProjectStore = defineStore("project", () => {
  // AI : Central store for project data to avoid circular dependencies
  const projects = ref<Record<string, Project>>({});
  const selectedProjectId = ref<string | null>(null);
  const countries = ref<Country[]>([]);

  // AI : Cache for cities by country and mode (key format: "countryCode:mode")
  const citiesCache = ref<
    Map<string, (RouterOutput["cities"]["getCitiesWithProjects"][number] & { distance: number })[]>
  >(new Map());

  // AI : Cache countries separately per mode
  const countriesCache = ref<Map<MapMode, Country[]>>(new Map());

  // AI : Centralized nearby projects data management
  const nearbyProjects = ref<NearbyProject[]>([]);
  const nearbyProjectsLoading = ref(false);
  const nearbyProjectsError = ref<string | null>(null);
  const nearbyProjectsLastFetch = ref<{ lat: number; lng: number; timestamp: number } | null>(null);

  // AI : User contributions cache - simple loaded flag
  const userContributions = ref<UserContribution[]>([]);
  const userContributionsLoading = ref(false);
  const userContributionsLoaded = ref(false);

  // AI : Cache original backend projects for change detection
  // AI : Stores snapshots of approved projects before local modifications
  const originalBackendProjects = ref<Record<string, Project>>({});

  // AI : Cache original user contributions for change detection (from MyContributionsPanel)
  // AI : Stores snapshots of contribution projects before local modifications
  const originalUserContributions = ref<Record<string, UserContribution>>({});

  // AI : Simple cache for city names (cityId -> city name)
  // AI : Populated when cities are used in forms or loaded from backend
  const cityNamesCache = ref<Record<number, string>>({});

  // AI : Helper to cache a city name
  function cacheCityName(cityId: number, cityName: string) {
    cityNamesCache.value = {
      ...cityNamesCache.value,
      [cityId]: cityName,
    };
  }

  // AI : Helper to get original project state for change detection
  // AI : Checks both originalBackendProjects (from map) and originalUserContributions (from MyContributions)
  function getOriginalProject(projectId: string): Project | UserContribution | null {
    return (
      originalBackendProjects.value[projectId] ?? originalUserContributions.value[projectId] ?? null
    );
  }

  // AI : Helper function to extract city metadata from project for user contributions
  function extractCityMetadata(project: Project) {
    const countryCode = project.city.countryCode;
    const country = countries.value.find((c) => c.code === countryCode);

    return {
      cityName: project.city.name,
      countryCode: countryCode,
      countryName: country?.name ?? null,
    };
  }

  // AI : Helper function to create overlay metadata for user contributions
  function createOverlayMetadata(
    overlay: OverlayObject,
    project: Project,
    filename: string,
    authorUsername: string | null,
  ) {
    return {
      id: overlay.id,
      name: overlay.caption ?? "Unnamed",
      filename: filename,
      status: "pending" as const,
      version: 1,
      projectId: project.id,
      authorId: overlay.authorId ?? null,
      authorUsername: authorUsername,
      authorApprovedCount: null,
      authorRejectedCount: null,
      replacesOverlayId: overlay.replacesOverlayId ?? null,
      replacedByOverlayId: null,
      updatedAt: new Date(),
      cityId: project.cityId,
      ...extractCityMetadata(project),
    };
  }

  // AI : Computed property for combined projects (local + nearby)
  const allProjects = computed(() => {
    const combined = { ...projects.value };

    // AI : Add nearby projects that aren't already in local projects
    nearbyProjects.value.forEach((nearbyProject: NearbyProject) => {
      combined[nearbyProject.id] ??= createProjectObjectFromAPI(nearbyProject);
    });

    return combined;
  });

  // AI : Writable computed for selected project ID
  const selectedProjectIdRef = computed({
    get: () => selectedProjectId.value,
    set: (value: string | null) => {
      selectedProjectId.value = value;
    },
  });

  // AI : User contributions actions
  function setUserContributions(contributions: UserContribution[]) {
    userContributions.value = contributions;
    userContributionsLoaded.value = true;

    // AI : Cache original backend state for change detection (only if not already cached)
    contributions.forEach((contribution) => {
      if (!originalUserContributions.value[contribution.id]) {
        originalUserContributions.value = {
          ...originalUserContributions.value,
          [contribution.id]: { ...contribution },
        };
      }
    });
  }

  function setUserContributionsLoading(loading: boolean) {
    userContributionsLoading.value = loading;
  }

  // AI : Reset user contributions cache to force refresh on next load
  function resetUserContributions() {
    userContributionsLoaded.value = false;
  }

  // AI : Optimistically add new overlay to user contributions without backend fetch
  function addOverlayToUserContributions(
    overlay: OverlayObject,
    project: Project,
    filename: string,
    authorUsername: string | null,
  ) {
    if (!userContributionsLoaded.value) {
      // AI : If contributions not loaded yet, skip optimistic update
      return;
    }

    // AI : Find existing project in contributions
    const existingProjectIndex = userContributions.value.findIndex((p) => p.id === project.id);

    if (existingProjectIndex !== -1) {
      // AI : Project exists, add overlay to its overlays array
      const existingProject = userContributions.value[existingProjectIndex];

      // AI : Check if overlay already exists in the project
      const existingOverlayIndex = existingProject.overlays.findIndex((o) => o.id === overlay.id);

      const overlayMetadata = createOverlayMetadata(overlay, project, filename, authorUsername);

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

      // AI : Cache the original project state with overlay for change detection
      // AI : Only cache if this is a new overlay (not replacing an existing one)
      if (existingOverlayIndex === -1 && !originalUserContributions.value[project.id]) {
        originalUserContributions.value = {
          ...originalUserContributions.value,
          [project.id]: { ...updatedProject } as UserContribution,
        };
      }
    } else {
      // AI : Project doesn't exist in contributions, add both project and overlay
      // AI : Skip if project is local-only (not yet submitted)
      if (project.status === null) {
        return;
      }

      const newProject = {
        ...project,
        ...extractCityMetadata(project),
        status: project.status, // AI : Type assertion - null already filtered above
        overlays: [createOverlayMetadata(overlay, project, filename, authorUsername)],
        overlayCount: 1,
      };

      userContributions.value = [newProject, ...userContributions.value];

      // AI : Cache the original project state for change detection
      if (!originalUserContributions.value[project.id]) {
        originalUserContributions.value = {
          ...originalUserContributions.value,
          [project.id]: { ...newProject } as UserContribution,
        };
      }
    }
  }

  // AI : Optimistically add new project to user contributions without backend fetch
  function addProjectToUserContributions(project: Project) {
    if (!userContributionsLoaded.value) {
      // AI : If contributions not loaded yet, skip optimistic update
      return;
    }

    // AI : Skip local-only projects (not yet submitted to backend)
    if (project.status === null) {
      return;
    }

    // AI : Check if project already exists
    const existingIndex = userContributions.value.findIndex((p) => p.id === project.id);
    if (existingIndex !== -1) {
      // AI : Project already exists, don't add duplicate
      return;
    }

    // AI : Create the new contribution entry
    const newContrib = {
      ...project,
      ...extractCityMetadata(project),
      status: project.status, // AI : Type assertion - null already filtered above
      overlays: [],
      overlayCount: 0,
    };

    // AI : Add new project to the beginning of the array
    userContributions.value = [newContrib, ...userContributions.value];

    // AI : Cache the original for change detection/reset functionality
    if (!originalUserContributions.value[project.id]) {
      originalUserContributions.value = {
        ...originalUserContributions.value,
        [project.id]: { ...newContrib } as UserContribution,
      };
    }
  }

  // AI : Update pending overlay in user contributions (for caption/field updates)
  function updateOverlayInUserContributions(
    overlayId: string,
    updates: Partial<UserContributionOverlay>,
  ) {
    if (!userContributionsLoaded.value) {
      return;
    }

    // AI : Find project containing this overlay
    const projectIndex = userContributions.value.findIndex((p) =>
      p.overlays.some((o: UserContributionOverlay) => o.id === overlayId),
    );

    if (projectIndex !== -1) {
      const project = userContributions.value[projectIndex];
      const overlayIndex = project.overlays.findIndex(
        (o: UserContributionOverlay) => o.id === overlayId,
      );

      if (overlayIndex !== -1) {
        const updatedOverlays = replaceAtIndex(project.overlays, overlayIndex, {
          ...project.overlays[overlayIndex],
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
  }

  // AI : Update pending project in user contributions (for field updates)
  function updateProjectInUserContributions(projectId: string, updates: Partial<UserContribution>) {
    if (!userContributionsLoaded.value) {
      return;
    }

    const projectIndex = userContributions.value.findIndex((p) => p.id === projectId);
    if (projectIndex !== -1) {
      const updatedProject = { ...userContributions.value[projectIndex], ...updates };
      userContributions.value = replaceAtIndex(
        userContributions.value,
        projectIndex,
        updatedProject,
      );
    }
  }

  // AI : Remove overlay from user contributions (for deletion)
  // AI : currentUserId param avoids circular dependency with authStore
  function removeOverlayFromUserContributions(overlayId: string, currentUserId?: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    // AI : Find project containing this overlay
    const projectIndex = userContributions.value.findIndex((p) =>
      p.overlays.some((o: UserContributionOverlay) => o.id === overlayId),
    );

    if (projectIndex !== -1) {
      const project = userContributions.value[projectIndex];
      const updatedOverlays = project.overlays.filter(
        (o: UserContributionOverlay) => o.id !== overlayId,
      );

      // AI : If no overlays left and user doesn't own project, remove entire project
      if (updatedOverlays.length === 0 && project.ownerId !== currentUserId) {
        userContributions.value = removeAtIndex(userContributions.value, projectIndex);
      } else {
        // AI : Update project with remaining overlays
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
  }

  // AI : Remove project from user contributions (for deletion)
  function removeProjectFromUserContributions(projectId: string) {
    if (!userContributionsLoaded.value) {
      return;
    }

    userContributions.value = userContributions.value.filter((p) => p.id !== projectId);
  }

  // AI : Update project in store with proper reactivity
  // AI : Can also create new project if it doesn't exist (when updates contains full project data)
  function updateProject(projectId: string, updates: Partial<Project>) {
    let current = projects.value[projectId];

    // AI : If project doesn't exist in local store, check allProjects (includes nearby)
    if (!current) {
      const allProjectsData = allProjects.value;
      current = allProjectsData[projectId];
    }

    // AI : Save original backend version before first modification (for change detection)
    // AI : This applies to all backend projects (approved, pending, or rejected)
    // AI : Cache original before first modification for reset functionality
    if (
      current &&
      !originalBackendProjects.value[projectId] &&
      current.status !== null && // AI : Has a backend status (not local-only)
      !current.isModified
    ) {
      originalBackendProjects.value = {
        ...originalBackendProjects.value,
        [projectId]: { ...current },
      };
    }

    // AI : Create new object with updates to trigger reactivity
    // AI : If current is undefined, we're creating a new project - use updates as the base
    projects.value = {
      ...projects.value,
      [projectId]: current ? { ...current, ...updates } : (updates as Project),
    };
  }

  // AI : Cache project backend state for change detection
  // AI : Called after successful submission to store baseline for future modifications
  function cacheProjectBackendState(projectId: string) {
    // AI : Check projects.value first, then allProjects (includes nearbyProjects)
    let project = projects.value[projectId];
    project ??= allProjects.value[projectId];

    if (project && !originalBackendProjects.value[projectId]) {
      originalBackendProjects.value = {
        ...originalBackendProjects.value,
        [projectId]: { ...project },
      };
    }
  }

  // AI : Reset a specific project field to its original backend value
  // AI : Used when user removes a single change from the submission dialog
  function resetProjectField(projectId: string, fieldName: string): boolean {
    let original = getOriginalProject(projectId);

    // AI : Fallback: if not in cache, check if project exists in userContributions
    if (!original) {
      const contribInList = userContributions.value.find((p) => p.id === projectId);
      if (contribInList) {
        // AI : Project exists but original wasn't cached - can't reset
        return false;
      }
      return false;
    }

    // AI : Get the original value to reset to
    const originalValue = (original as any)[fieldName];

    let didReset = false;

    // AI : Update in projects store if present
    const current = projects.value[projectId];
    if (current && originalValue !== undefined) {
      updateProject(projectId, { [fieldName]: originalValue });
      didReset = true;
    }

    // AI : Also update user contributions if present (critical for MyContributionsPanel)
    const contribIndex = userContributions.value.findIndex((p) => p.id === projectId);
    if (contribIndex !== -1 && originalValue !== undefined) {
      const contrib = userContributions.value[contribIndex];
      const updatedContrib = { ...contrib, [fieldName]: originalValue };
      userContributions.value = replaceAtIndex(
        userContributions.value,
        contribIndex,
        updatedContrib,
      );
      didReset = true;
    }

    return didReset;
  }

  // AI : Fetch nearby projects with smart caching to avoid redundant API calls
  // AI : Cache is valid for 5 minutes and invalidated if map moves >11km from cached position
  // AI : Accepts coordinates as parameters to avoid circular dependency with useMap composable
  async function fetchNearbyProjects(
    lat: number,
    lng: number,
    force = false,
  ): Promise<NearbyProject[]> {
    try {
      const now = Date.now();

      // AI : Check if we have cached data and don't need to refetch
      if (!force && nearbyProjectsLastFetch.value) {
        const { lat: cachedLat, lng: cachedLng, timestamp } = nearbyProjectsLastFetch.value;
        const CACHE_DURATION = 5 * 60 * 1000; // AI : 5 minutes cache
        const LOCATION_THRESHOLD = 0.1; // AI : ~11km at equator

        // AI : Calculate distance from cached location
        const latDiff = Math.abs(lat - cachedLat);
        const lngDiff = Math.abs(lng - cachedLng);

        // AI : If location hasn't changed much and cache is fresh, return cached data
        if (
          latDiff < LOCATION_THRESHOLD &&
          lngDiff < LOCATION_THRESHOLD &&
          now - timestamp < CACHE_DURATION
        ) {
          return nearbyProjects.value;
        }
      }

      nearbyProjectsLoading.value = true;
      nearbyProjectsError.value = null;

      // AI : Call the TRPC endpoint to fetch nearby projects
      const response = await trpc.project.getProjectsNearLocation.query({
        lat,
        lng,
      });

      nearbyProjects.value = response.projects;
      nearbyProjectsLastFetch.value = {
        lat,
        lng,
        timestamp: now,
      };

      return response.projects;
    } catch (error) {
      console.error("Error fetching nearby projects:", error);
      nearbyProjectsError.value =
        error instanceof Error ? error.message : "Failed to fetch nearby projects";
      return [];
    } finally {
      nearbyProjectsLoading.value = false;
    }
  }

  function setNearbyProjects(projectsData: NearbyProject[]) {
    nearbyProjects.value = projectsData;
    nearbyProjectsError.value = null;
  }

  function clearNearbyProjects(): void {
    nearbyProjects.value = [];
    nearbyProjectsError.value = null;
    nearbyProjectsLastFetch.value = null;
  }

  function setNearbyProjectsLoading(loading: boolean): void {
    nearbyProjectsLoading.value = loading;
  }

  function setNearbyProjectsError(error: string | null): void {
    nearbyProjectsError.value = error;
  }

  /**
   * AI : Add an overlay to a project by ID
   * @param projectId - The ID of the project
   * @param overlayId - The ID of the overlay to add
   */
  function addOverlayToProjectWithId(projectId: string, overlayId: string) {
    const project = projects.value[projectId];
    if (project) {
      if (!project.overlayIds.includes(overlayId)) {
        project.overlayIds.push(overlayId);
        // AI : Local storage removed - changes are now stored only in memory during edit mode
      }
    }
  }

  function getCachedCities(countryCode: string, mode: MapMode) {
    return citiesCache.value.get(getCitiesCacheKey(countryCode, mode)) ?? null;
  }

  function setCachedCities(
    countryCode: string,
    mode: MapMode,
    cities: (RouterOutput["cities"]["getCitiesWithProjects"][number] & { distance: number })[],
  ): void {
    citiesCache.value.set(getCitiesCacheKey(countryCode, mode), cities);
  }

  function hasCachedCities(countryCode: string, mode: MapMode): boolean {
    return citiesCache.value.has(getCitiesCacheKey(countryCode, mode));
  }

  function clearCitiesCache(): void {
    citiesCache.value.clear();
  }

  // AI : Countries cache management - store and retrieve countries per mode
  function getCachedCountries(mode: MapMode): Country[] | null {
    return countriesCache.value.get(mode) ?? null;
  }

  function setCachedCountries(mode: MapMode, countriesData: Country[]): void {
    countriesCache.value.set(mode, countriesData);
  }

  function hasCachedCountries(mode: MapMode): boolean {
    return countriesCache.value.has(mode);
  }

  function clearCountriesCache(): void {
    countriesCache.value.clear();
  }

  // AI : Clear all state on logout/account switch
  function clearAllState(): void {
    // AI : Clear projects and selection
    projects.value = {};
    selectedProjectId.value = null;
    countries.value = [];

    // AI : Clear user contributions
    userContributions.value = [];
    userContributionsLoading.value = false;
    userContributionsLoaded.value = false;

    // AI : Clear nearby projects
    clearNearbyProjects();

    // AI : Clear original backend state caches
    originalBackendProjects.value = {};
    originalUserContributions.value = {};

    // AI : Clear city names cache
    cityNamesCache.value = {};

    // AI : Clear all caches
    clearCitiesCache();
    clearCountriesCache();
  }

  return {
    // State
    projects,
    selectedProjectId,
    countries,
    nearbyProjects,
    nearbyProjectsLoading,
    nearbyProjectsError,
    userContributions,
    userContributionsLoading,
    userContributionsLoaded,
    originalBackendProjects,
    originalUserContributions,
    cityNamesCache,

    // Computed properties
    allProjects,
    selectedProjectIdRef,

    // Local project actions
    addOverlayToProjectWithId,
    updateProject,
    cacheProjectBackendState,
    resetProjectField,
    cacheCityName,
    getOriginalProject,

    // User contributions actions
    setUserContributions,
    setUserContributionsLoading,
    resetUserContributions,
    addOverlayToUserContributions,
    addProjectToUserContributions,
    updateOverlayInUserContributions,
    updateProjectInUserContributions,
    removeOverlayFromUserContributions,
    removeProjectFromUserContributions,

    // Nearby projects actions
    fetchNearbyProjects,
    setNearbyProjects,
    clearNearbyProjects,
    setNearbyProjectsLoading,
    setNearbyProjectsError,

    // Cities cache actions
    getCachedCities,
    setCachedCities,
    hasCachedCities,
    clearCitiesCache,

    // Countries cache actions
    getCachedCountries,
    setCachedCountries,
    hasCachedCountries,
    clearCountriesCache,

    // Comprehensive cleanup
    clearAllState,
  };
});
