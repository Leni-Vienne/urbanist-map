import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Project, Country, MapMode, OverlayObject } from '@types';
import type { NearbyProject } from '../../types/api';
import { map } from '@composables/core/useMap';
import { trpc, RouterOutput } from '@client';
import { createProjectObjectFromAPI } from '../../utils/typeFactories';

// AI : Type for user contributions from backend
type UserContribution = RouterOutput['project']['getUsersContributions']['projects'][number];
type UserContributionOverlay = UserContribution['overlays'][number];

// AI : Helper function to replace an item in an array immutably at a given index
function replaceAtIndex<T>(arr: T[], index: number, newItem: T): T[] {
  return [...arr.slice(0, index), newItem, ...arr.slice(index + 1)];
}

// AI : Helper function to remove an item from an array immutably at a given index
function removeAtIndex<T>(arr: T[], index: number): T[] {
  return [...arr.slice(0, index), ...arr.slice(index + 1)];
}

// AI : Helper function to extract city metadata from project for user contributions
function extractCityMetadata(project: Project) {
  return {
    cityName: project.city?.name ?? null,
    countryCode: project.city?.countryCode ?? null,
    countryName: null,
  };
}

// AI : Helper function to create overlay metadata for user contributions
function createOverlayMetadata(overlay: OverlayObject, project: Project, filename: string) {
  return {
    id: overlay.id,
    name: overlay.caption ?? 'Unnamed',
    filename: filename,
    status: 'pending' as const,
    version: 1,
    projectId: project.id,
    authorId: overlay.authorId ?? null,
    authorUsername: null,
    authorApprovedCount: null,
    authorRejectedCount: null,
    replacesOverlayId: overlay.replacesOverlayId ?? null,
    replacedByOverlayId: null,
    updatedAt: new Date(),
    cityId: project.cityId,
    ...extractCityMetadata(project),
  };
}

export const useProjectStore = defineStore('project', () => {
  // AI : Central store for project data to avoid circular dependencies
  const projects = ref<Record<string, Project>>({});
  const selectedProjectId = ref<string | null>(null);
  const countries = ref<Country[]>([]);

  // AI : Cache for cities by country and mode (key format: "countryCode:mode")
  const citiesCache = ref<Map<string, Array<RouterOutput['cities']['getCitiesWithProjects'][number] & { distance: number }>>>(new Map());

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

  // AI : Simple cache for city names (cityId -> city name)
  // AI : Populated when cities are used in forms or loaded from backend
  const cityNamesCache = ref<Record<string, string>>({});

  // AI : Helper to cache a city name
  function cacheCityName(cityId: string, cityName: string) {
    cityNamesCache.value = {
      ...cityNamesCache.value,
      [cityId]: cityName
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
    }
  });

  // AI : User contributions actions
  const setUserContributions = (contributions: UserContribution[]) => {
    userContributions.value = contributions;
    userContributionsLoaded.value = true;
  };

  const setUserContributionsLoading = (loading: boolean) => {
    userContributionsLoading.value = loading;
  };

  // AI : Reset user contributions cache to force refresh on next load
  const resetUserContributions = () => {
    userContributionsLoaded.value = false;
  };

  // AI : Optimistically add new overlay to user contributions without backend fetch
  const addOverlayToUserContributions = (overlay: OverlayObject, project: Project, filename: string) => {
    if (!userContributionsLoaded.value) {
      // AI : If contributions not loaded yet, skip optimistic update
      return;
    }

    // AI : Find existing project in contributions
    const existingProjectIndex = userContributions.value.findIndex(p => p.id === project.id);

    if (existingProjectIndex >= 0) {
      // AI : Project exists, add overlay to its overlays array
      const existingProject = userContributions.value[existingProjectIndex];
      const updatedProject = {
        ...existingProject,
        overlays: [
          ...existingProject.overlays,
          createOverlayMetadata(overlay, project, filename)
        ],
        overlayCount: existingProject.overlayCount + 1,
      };

      userContributions.value = replaceAtIndex(userContributions.value, existingProjectIndex, updatedProject);
    } else {
      // AI : Project doesn't exist in contributions, add both project and overlay
      // AI : Skip if project is local-only (not yet submitted)
      if (project.status === null) {
        return;
      }

      userContributions.value = [
        {
          ...project,
          ...extractCityMetadata(project),
          status: project.status, // AI : Type assertion - null already filtered above
          overlays: [createOverlayMetadata(overlay, project, filename)],
          overlayCount: 1,
        },
        ...userContributions.value,
      ];
    }
  };

  // AI : Optimistically add new project to user contributions without backend fetch
  const addProjectToUserContributions = (project: Project) => {
    if (!userContributionsLoaded.value) {
      // AI : If contributions not loaded yet, skip optimistic update
      return;
    }

    // AI : Skip local-only projects (not yet submitted to backend)
    if (project.status === null) {
      return;
    }

    // AI : Check if project already exists
    const existingIndex = userContributions.value.findIndex(p => p.id === project.id);
    if (existingIndex >= 0) {
      // AI : Project already exists, don't add duplicate
      return;
    }

    // AI : Add new project to the beginning of the array
    userContributions.value = [
      {
        ...project,
        ...extractCityMetadata(project),
        status: project.status, // AI : Type assertion - null already filtered above
        overlays: [],
        overlayCount: 0,
      },
      ...userContributions.value,
    ];
  };

  // AI : Update pending overlay in user contributions (for caption/field updates)
  const updateOverlayInUserContributions = (overlayId: string, updates: Partial<UserContributionOverlay>) => {
    if (!userContributionsLoaded.value) {
      return;
    }

    // AI : Find project containing this overlay
    const projectIndex = userContributions.value.findIndex(p =>
      p.overlays.some((o: UserContributionOverlay) => o.id === overlayId)
    );

    if (projectIndex >= 0) {
      const project = userContributions.value[projectIndex];
      const overlayIndex = project.overlays.findIndex((o: UserContributionOverlay) => o.id === overlayId);

      if (overlayIndex >= 0) {
        const updatedOverlays = replaceAtIndex(project.overlays, overlayIndex, { ...project.overlays[overlayIndex], ...updates });
        const updatedProject = { ...project, overlays: updatedOverlays };
        userContributions.value = replaceAtIndex(userContributions.value, projectIndex, updatedProject);
      }
    }
  };

  // AI : Update pending project in user contributions (for field updates)
  const updateProjectInUserContributions = (projectId: string, updates: Partial<UserContribution>) => {
    if (!userContributionsLoaded.value) {
      return;
    }

    const projectIndex = userContributions.value.findIndex(p => p.id === projectId);
    if (projectIndex >= 0) {
      const updatedProject = { ...userContributions.value[projectIndex], ...updates };
      userContributions.value = replaceAtIndex(userContributions.value, projectIndex, updatedProject);
    }
  };

  // AI : Remove overlay from user contributions (for deletion)
  const removeOverlayFromUserContributions = (overlayId: string) => {
    if (!userContributionsLoaded.value) {
      return;
    }

    // AI : Find project containing this overlay
    const projectIndex = userContributions.value.findIndex(p =>
      p.overlays.some((o: UserContributionOverlay) => o.id === overlayId)
    );

    if (projectIndex >= 0) {
      const project = userContributions.value[projectIndex];
      const updatedOverlays = project.overlays.filter((o: UserContributionOverlay) => o.id !== overlayId);

      // AI : If no overlays left and user doesn't own project, remove entire project
      if (updatedOverlays.length === 0 && project.ownerId !== project.ownerId) {
        userContributions.value = removeAtIndex(userContributions.value, projectIndex);
      } else {
        // AI : Update project with remaining overlays
        const updatedProject = {
          ...project,
          overlays: updatedOverlays,
          overlayCount: updatedOverlays.length,
        };
        userContributions.value = replaceAtIndex(userContributions.value, projectIndex, updatedProject);
      }
    }
  };

  // AI : Remove project from user contributions (for deletion)
  const removeProjectFromUserContributions = (projectId: string) => {
    if (!userContributionsLoaded.value) {
      return;
    }

    userContributions.value = userContributions.value.filter(p => p.id !== projectId);
  };

  // AI : Update project in store with proper reactivity
  function updateProject(projectId: string, updates: Partial<Project>) {
    let current = projects.value[projectId];

    // AI : If project doesn't exist in local store, check allProjects (includes nearby)
    if (!current) {
      const allProjectsData = allProjects.value;
      current = allProjectsData[projectId];
    }

    // AI : Save original backend version before first modification (for change detection)
    // AI : This applies to both approved and pending projects
    if (!originalBackendProjects.value[projectId] &&
        (current.status === 'approved' || current.status === 'pending') &&
        !current.isModified) {
      originalBackendProjects.value = {
        ...originalBackendProjects.value,
        [projectId]: { ...current }
      };
    }

    // AI : Create new object with updates to trigger reactivity
    projects.value = {
      ...projects.value,
      [projectId]: { ...current, ...updates }
    };
  }

  // AI : Cache project backend state for change detection
  // AI : Called after successful submission to store baseline for future modifications
  function cacheProjectBackendState(projectId: string) {
    const project = projects.value[projectId];
    if (project) {
      originalBackendProjects.value = {
        ...originalBackendProjects.value,
        [projectId]: { ...project }
      };
    }
  }

  // AI : Fetch nearby projects with smart caching to avoid redundant API calls
  // AI : Cache is valid for 5 minutes and invalidated if map moves >11km from cached position
  async function fetchNearbyProjects(force = false): Promise<NearbyProject[]> {
    try {
      if (!map.value) {
        console.warn('Map not available for fetching nearby projects');
        return [];
      }

      // AI : Get current map center coordinates
      const center = map.value.getCenter();
      const now = Date.now();

      // AI : Check if we have cached data and don't need to refetch
      if (!force && nearbyProjectsLastFetch.value) {
        const { lat: cachedLat, lng: cachedLng, timestamp } = nearbyProjectsLastFetch.value;
        const CACHE_DURATION = 5 * 60 * 1000; // AI : 5 minutes cache
        const LOCATION_THRESHOLD = 0.1; // AI : ~11km at equator

        // AI : Calculate distance from cached location
        const latDiff = Math.abs(center.lat - cachedLat);
        const lngDiff = Math.abs(center.lng - cachedLng);

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
        lat: center.lat,
        lng: center.lng,
      });

      nearbyProjects.value = response.projects;
      nearbyProjectsLastFetch.value = {
        lat: center.lat,
        lng: center.lng,
        timestamp: now
      };

      return response.projects;
    } catch (err) {
      console.error('Error fetching nearby projects:', err);
      nearbyProjectsError.value = err instanceof Error ? err.message : 'Failed to fetch nearby projects';
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

  // AI : Cities cache management (separate cache per mode)
  function getCitiesCacheKey(countryCode: string, mode: MapMode): string {
    return `${countryCode}:${mode}`
  }

  function getCachedCities(countryCode: string, mode: MapMode) {
    return citiesCache.value.get(getCitiesCacheKey(countryCode, mode)) ?? null
  }

  function setCachedCities(countryCode: string, mode: MapMode, cities: Array<RouterOutput['cities']['getCitiesWithProjects'][number] & { distance: number }>): void {
    citiesCache.value.set(getCitiesCacheKey(countryCode, mode), cities)
  }

  function hasCachedCities(countryCode: string, mode: MapMode): boolean {
    return citiesCache.value.has(getCitiesCacheKey(countryCode, mode))
  }

  function clearCitiesCache(): void {
    citiesCache.value.clear()
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
    cityNamesCache,

    // Computed properties
    allProjects,
    selectedProjectIdRef,

    // Local project actions
    addOverlayToProjectWithId,
    updateProject,
    cacheProjectBackendState,
    cacheCityName,

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
    clearCountriesCache
  };
})
