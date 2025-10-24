import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Project, Country, MapMode } from '@types';
import type { NearbyProject } from '../../types/api';
import { map } from '@composables/core/useMap';
import { trpc, RouterOutput } from '@client';
import { createProjectFromAPI } from '../../utils/typeFactories';

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
  const userContributions = ref<any[]>([]);
  const userContributionsLoading = ref(false);
  const userContributionsLoaded = ref(false);

  // AI : Computed property for combined projects (local + nearby)
  const allProjects = computed(() => {
    const combined = { ...projects.value };

    // AI : Add nearby projects that aren't already in local projects
    nearbyProjects.value.forEach((nearbyProject: NearbyProject) => {
      combined[nearbyProject.id] ??= createProjectFromAPI(nearbyProject);
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
  const setUserContributions = (contributions: any[]) => {
    userContributions.value = contributions;
    userContributionsLoaded.value = true;
  };

  const setUserContributionsLoading = (loading: boolean) => {
    userContributionsLoading.value = loading;
  };

  // AI : Update project in store with proper reactivity
  function updateProject(projectId: string, updates: Partial<Project>) {
    let current = projects.value[projectId];
    
    // AI : If project doesn't exist in local store, check allProjects (includes nearby)
    if (!current) {
      const allProjectsData = allProjects.value;
      current = allProjectsData[projectId];
      
      // AI : If still not found, can't update
      if (!current) return;
    }

    // AI : Create new object with updates to trigger reactivity
    projects.value = {
      ...projects.value,
      [projectId]: { ...current, ...updates }
    };
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

    // Computed properties
    allProjects,
    selectedProjectIdRef,
    
    // Local project actions
    addOverlayToProjectWithId,
    updateProject,

    // User contributions actions
    setUserContributions,
    setUserContributionsLoading,

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
