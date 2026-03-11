import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import type {
  Project,
  Country,
  OverlayObject,
  NearbyProject,
  UserContribution,
  UserContributionOverlay,
} from "@/types/index";
import type { AppMode } from "@shared/types";
import { trpc, type RouterOutput } from "@/client";
import {
  createProjectObjectFromAPI,
  createProjectObject,
  createProjectFromUserContribution,
} from "@/utils/typeFactories";

// Helper function to replace an item in an array immutably at a given index
function replaceAtIndex<T>(arr: T[], index: number, newItem: T): T[] {
  return [...arr.slice(0, index), newItem, ...arr.slice(index + 1)];
}

// Helper function to remove an item from an array immutably at a given index
function removeAtIndex<T>(arr: T[], index: number): T[] {
  return [...arr.slice(0, index), ...arr.slice(index + 1)];
}

// Cities cache management (separate cache per mode)
function getCitiesCacheKey(countryCode: string, mode: AppMode): string {
  return `${countryCode}:${mode}`;
}

// Helper to generate cache key from parameters (exported for use in composables)
function getUserContributionsCacheKey(options?: {
  cityId?: number;
  includeCityProjects?: boolean;
}): string {
  const cityId = options?.cityId ?? null;
  const includeCityProjects = options?.includeCityProjects ?? false;
  return `${cityId}:${includeCityProjects}`;
}

export const useProjectStore = defineStore("project", () => {
  // Central store for project data to avoid circular dependencies
  const projects = ref<Record<string, Project>>({});
  const selectedProjectId = ref<string | null>(null);
  const countries = ref<Country[]>([]);

  // Cache for cities by country and mode (key format: "countryCode:mode")
  const citiesCache = ref<
    Map<string, (RouterOutput["cities"]["getCitiesWithProjects"][number] & { distance: number })[]>
  >(new Map());

  // Cache for global cities by mode (no country filter)
  const globalCitiesCache = ref<Map<AppMode, RouterOutput["cities"]["getCitiesWithProjects"]>>(
    new Map(),
  );

  // Cache countries separately per mode
  const countriesCache = ref<Map<AppMode, Country[]>>(new Map());

  // Centralized nearby projects data management
  const nearbyProjects = ref<NearbyProject[]>([]);
  const nearbyProjectsLastFetch = ref<{ lat: number; lng: number; timestamp: number } | null>(null);

  // User contributions cache - Map-based cache for different parameter combinations
  const userContributions = ref<UserContribution[]>([]);
  const userContributionsLoading = ref(false);
  // Cache key format: "cityId:includeCityProjects" (e.g., "null:false", "3029241:true")
  const userContributionsCache = ref<Map<string, UserContribution[]>>(new Map());

  // Cache original projects for change detection
  // Stores snapshots of projects (from map or contributions) before local modifications
  const originalProjects = ref<Record<string, Project | UserContribution>>({});

  // Simple cache for city names (cityId -> city name)
  // Populated when cities are used in forms or loaded from backend
  const cityNamesCache = ref<Record<number, string>>({});

  // Helper to cache a city name
  function cacheCityName(cityId: number, cityName: string) {
    cityNamesCache.value = {
      ...cityNamesCache.value,
      [cityId]: cityName,
    };
  }

  // Helper to get original project state for change detection
  function getOriginalProject(projectId: string): Project | UserContribution | null {
    return originalProjects.value[projectId] ?? null;
  }

  // Helper function to extract city metadata from project for user contributions
  function extractCityMetadata(project: Project) {
    const countryCode = project.city.countryCode;
    const country = countries.value.find((c) => c.code === countryCode);

    return {
      cityName: project.city.name,
      countryCode: countryCode,
      countryName: country?.name ?? null,
    };
  }

  // Helper function to create overlay metadata for user contributions
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
      imageUrl: overlay.imageUrl, // Pass the full image URL (Data URI or backend URL)
      ...extractCityMetadata(project),
    };
  }

  // Computed property for combined projects (local + nearby)
  const allProjects = computed(() => {
    const combined = { ...projects.value };

    // Add nearby projects that aren't already in local projects
    for (const nearbyProject of nearbyProjects.value) {
      combined[nearbyProject.id] ??= createProjectObjectFromAPI(nearbyProject);
    }

    return combined;
  });

  // User contributions actions
  function setUserContributions(contributions: UserContribution[], cacheKey: string) {
    userContributions.value = contributions;
    userContributionsCache.value.set(cacheKey, contributions);

    // Cache original state for change detection (only if not already cached)
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

  // Optimistically add new overlay to user contributions without backend fetch
  function addOverlayToUserContributions(
    overlay: OverlayObject,
    project: Project,
    filename: string,
    authorUsername: string | null,
  ) {
    if (userContributionsCache.value.size === 0) {
      // If contributions not loaded yet, skip optimistic update
      return;
    }

    // Find existing project in contributions
    const existingProjectIndex = userContributions.value.findIndex((p) => p.id === project.id);

    if (existingProjectIndex !== -1) {
      // Project exists, add overlay to its overlays array
      const existingProject = userContributions.value[existingProjectIndex];

      if (!existingProject) {
        console.error("Existing project not found for ID:", project.id);
        return;
      }

      // Check if overlay already exists in the project
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

      // Cache the original project state with overlay for change detection
      // Only cache if this is a new overlay (not replacing an existing one)
      if (existingOverlayIndex === -1 && !originalProjects.value[project.id]) {
        originalProjects.value = {
          ...originalProjects.value,
          [project.id]: { ...updatedProject } as UserContribution,
        };
      }
    } else {
      // Project doesn't exist in contributions, add both project and overlay
      // Skip if project is local-only (not yet submitted)
      if (project.status === null) {
        return;
      }

      const newProject = {
        ...project,
        ...extractCityMetadata(project),
        status: project.status, // Type assertion - null already filtered above
        overlays: [createOverlayMetadata(overlay, project, filename, authorUsername)],
        overlayCount: 1,
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

  // Optimistically add new project to user contributions without backend fetch
  function addProjectToUserContributions(project: Project) {
    if (userContributionsCache.value.size === 0) {
      // If contributions not loaded yet, skip optimistic update
      return;
    }

    // Skip local-only projects (not yet submitted to backend)
    if (project.status === null) {
      return;
    }

    // Check if project already exists
    const existingIndex = userContributions.value.findIndex((p) => p.id === project.id);
    if (existingIndex !== -1) {
      // Project already exists, don't add duplicate
      return;
    }

    // Create the new contribution entry
    const newContrib = {
      ...project,
      ...extractCityMetadata(project),
      status: project.status, // Type assertion - null already filtered above
      overlays: [],
      overlayCount: 0,
    };

    // Add new project to the beginning of the array
    userContributions.value = [newContrib, ...userContributions.value];

    // Cache the original for change detection/reset functionality
    if (!originalProjects.value[project.id]) {
      originalProjects.value = {
        ...originalProjects.value,
        [project.id]: { ...newContrib } as UserContribution,
      };
    }
  }

  // Find the project containing an overlay by ID, returns index + project or null
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

  // Update pending project in user contributions (for field updates)
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

  // Remove overlay from user contributions (for deletion)
  // currentUserId param avoids circular dependency with authStore
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

  // Remove project from user contributions (for deletion)
  function removeProjectFromUserContributions(projectId: string) {
    if (userContributionsCache.value.size === 0) {
      return;
    }

    userContributions.value = userContributions.value.filter((p) => p.id !== projectId);
  }

  // Update project in store with proper reactivity
  // Can also create new project if it doesn't exist (when updates contains full project data)
  function updateProject(projectId: string, updates: Partial<Project>) {
    let current = projects.value[projectId];

    // If project doesn't exist in local store, check allProjects (includes nearby)
    if (!current) {
      const allProjectsData = allProjects.value;
      current = allProjectsData[projectId];
    }

    // Pending projects may only exist in user contributions until the user edits them locally.
    if (!current) {
      const contributionProject = userContributions.value.find(
        (project) => project.id === projectId,
      );
      if (contributionProject) {
        current = createProjectFromUserContribution(contributionProject);
      }
    }

    // Save original version before first modification (for change detection)
    // This applies to all backend projects (approved, pending, or rejected)
    // Cache original before first modification for reset functionality
    if (
      current &&
      !originalProjects.value[projectId] &&
      current.status !== null && // Has a backend status (not local-only)
      !current.isModified
    ) {
      originalProjects.value = {
        ...originalProjects.value,
        [projectId]: { ...current },
      };
    }

    // Create new object with updates to trigger reactivity
    // If current is undefined, we're creating a new project - use updates as the base
    projects.value = {
      ...projects.value,
      [projectId]: current ? { ...current, ...updates } : createProjectObject(updates),
    };
  }

  // Cache project backend state for change detection
  // Called after successful submission to store baseline for future modifications
  function cacheProjectBackendState(projectId: string) {
    // Check projects.value first, then allProjects (includes nearbyProjects)
    let project = projects.value[projectId];
    project ??= allProjects.value[projectId];

    if (project && !originalProjects.value[projectId]) {
      originalProjects.value = {
        ...originalProjects.value,
        [projectId]: { ...project },
      };
    }
  }

  // Reset a specific project field to its original backend value
  // Used when user removes a single change from the submission dialog
  function resetProjectField(projectId: string, fieldName: string): boolean {
    const original = getOriginalProject(projectId);

    // Fallback: if not in cache, check if project exists in userContributions
    if (!original) {
      const contribInList = userContributions.value.find((p) => p.id === projectId);
      if (contribInList) {
        // Project exists but original wasn't cached - can't reset
        return false;
      }
      return false;
    }

    // Get the original value to reset to
    const originalValue = (original as Record<string, unknown>)[fieldName];

    let didReset = false;

    // Update in projects store if present
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

  // Fetch nearby projects with smart caching to avoid redundant API calls
  // Cache is valid for 5 minutes and invalidated if map moves >11km from cached position
  // Accepts coordinates as parameters to avoid circular dependency with useMap composable
  async function fetchNearbyProjects(
    lat: number,
    lng: number,
    force = false,
  ): Promise<NearbyProject[]> {
    try {
      const now = Date.now();

      // Check if we have cached data and don't need to refetch
      if (!force && nearbyProjectsLastFetch.value) {
        const { lat: cachedLat, lng: cachedLng, timestamp } = nearbyProjectsLastFetch.value;
        const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
        const LOCATION_THRESHOLD = 0.1; // ~11km at equator

        // Calculate distance from cached location
        const latDiff = Math.abs(lat - cachedLat);
        const lngDiff = Math.abs(lng - cachedLng);

        // If location hasn't changed much and cache is fresh, return cached data
        if (
          latDiff < LOCATION_THRESHOLD &&
          lngDiff < LOCATION_THRESHOLD &&
          now - timestamp < CACHE_DURATION
        ) {
          return nearbyProjects.value;
        }
      }

      // Call the TRPC endpoint to fetch nearby projects
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
      return [];
    }
  }

  function clearNearbyProjects(): void {
    nearbyProjects.value = [];
    nearbyProjectsLastFetch.value = null;
  }

  function getCachedCities(countryCode: string, mode: AppMode) {
    return citiesCache.value.get(getCitiesCacheKey(countryCode, mode)) ?? null;
  }

  function setCachedCities(
    countryCode: string,
    mode: AppMode,
    cities: (RouterOutput["cities"]["getCitiesWithProjects"][number] & { distance: number })[],
  ): void {
    citiesCache.value.set(getCitiesCacheKey(countryCode, mode), cities);
  }

  function hasCachedCities(countryCode: string, mode: AppMode): boolean {
    return citiesCache.value.has(getCitiesCacheKey(countryCode, mode));
  }

  function clearCitiesCache(): void {
    citiesCache.value.clear();
  }

  // Countries cache management - store and retrieve countries per mode
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

  // Clear all state on logout/account switch
  // Clear user-specific state on logout/account switch
  // NOTE: We preserve public data (countries, view-mode caches)
  // and only clear user-specific data
  function clearAllState(): void {
    // Clear projects and selection (keep the data but clear selection)
    // Actually, we should clear user-specific projects but keep approved ones
    // For simplicity, clear all projects and let them reload with view-mode permissions
    projects.value = {};
    selectedProjectId.value = null;

    // KEEP countries - these are needed for public map view
    // countries.value = [];

    // Clear user contributions (user-specific)
    userContributions.value = [];
    userContributionsLoading.value = false;
    userContributionsCache.value.clear();

    // Clear nearby projects (context-specific)
    clearNearbyProjects();

    // Clear original state cache (user-specific)
    originalProjects.value = {};

    // Clear city names cache (can be rebuilt)
    cityNamesCache.value = {};

    // Clear mode-specific caches but keep view-mode caches
    // The cache keys include mode, so view-mode caches will persist
    // We only need to clear edit/moderation mode caches
    // For now, we'll clear all caches and let view mode reload
    // (This is safer and cleaner)
    clearCitiesCache();
    clearCountriesCache();
  }

  // Fetch global cities with projects (migrated from useCityMarkers)
  // Uses cache to avoid redundant API calls on mode switches
  async function fetchCitiesWithProjects(
    mode: AppMode,
  ): Promise<RouterOutput["cities"]["getCitiesWithProjects"]> {
    // Check cache first
    const cached = globalCitiesCache.value.get(mode);
    if (cached) {
      return cached;
    }

    try {
      const response = await trpc.cities.getCitiesWithProjects.query({ mode });
      // Store in cache
      globalCitiesCache.value.set(mode, response);
      return response;
    } catch (error) {
      console.error("Error fetching cities with projects:", error);
      throw error;
    }
  }

  // Helper to merge backend cities with cities from local/pending projects
  // extracted from cityMarkers.ts to centralize data logic
  function getMergedCities(
    backendCities: RouterOutput["cities"]["getCitiesWithProjects"],
    currentUserId: string | null,
  ): RouterOutput["cities"]["getCitiesWithProjects"] {
    // Include both local (unsaved) and user's pending projects
    const userProjectsToInclude = Object.values(projects.value).filter((p) => {
      // Local projects (not yet submitted)
      if (p.status === null) return true;

      // User's own pending projects (submitted but not approved)
      if (p.status === "pending" && currentUserId && p.ownerId === currentUserId) return true;

      return false;
    });

    if (userProjectsToInclude.length === 0) {
      return backendCities;
    }

    // Build a map of city IDs from user projects
    // Explicitly type as Map<number, CityWithProjects>
    const localProjectCitiesMap = new Map<
      number,
      RouterOutput["cities"]["getCitiesWithProjects"][number]
    >();

    for (const project of userProjectsToInclude) {
      if (project.cityId) {
        // Only add to map if not already present
        if (!localProjectCitiesMap.has(project.cityId)) {
          localProjectCitiesMap.set(project.cityId, {
            id: project.cityId,
            name: project.city.name,
            nameLocal: project.city.nameLocal ?? null,
            lat: project.city.coordinates.y,
            lng: project.city.coordinates.x,
            countryCode: project.city.countryCode,
            projectCount: 0, // Local projects, count doesn't matter for display
          });
        }
      }
    }

    // Add cities from local projects that aren't already in the city list
    const existingCityIds = new Set(backendCities.map((c) => c.id));
    const additionalCities: RouterOutput["cities"]["getCitiesWithProjects"] = [];

    for (const [cityId, cityData] of localProjectCitiesMap) {
      if (!existingCityIds.has(cityId)) {
        additionalCities.push(cityData);
      }
    }

    return additionalCities.length > 0 ? [...backendCities, ...additionalCities] : backendCities;
  }

  return {
    // State
    projects,
    selectedProjectId,
    countries,
    nearbyProjects,
    userContributions,
    userContributionsLoading,
    userContributionsCache,
    cityNamesCache,

    // Computed properties
    allProjects,

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

    // Nearby projects actions
    fetchNearbyProjects,

    // Cities cache actions
    getCachedCities,
    setCachedCities,
    hasCachedCities,

    // Countries cache actions
    getCachedCountries,
    setCachedCountries,
    hasCachedCountries,

    // New Data Fetching Actions
    fetchCitiesWithProjects,
    getMergedCities,

    // Comprehensive cleanup
    clearAllState,
  };
});

// Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}
