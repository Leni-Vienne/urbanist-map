// AI : Unified city data fetching with request deduplication
// AI : Consolidates three duplicate fetch functions into one with flexible options
import { trpc } from "@/client";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { useSelectedProject } from "@/composables/project/useProjectSelection";
import { fetchCityProjectsData } from "@/composables/map/useCityOverlays";
import type { OverlayData } from "@/types/index";

/**
 * AI : Options for fetching city data
 */
export interface FetchCityDataOptions {
  cityId: number;

  // AI : Cache control
  forceRefresh?: boolean; // Skip cache, always fetch fresh data

  // AI : Side effects - update selected city
  updateSelectedCity?: boolean; // Update mapStore.selectedCity

  // AI : Side effects - clear state on city switch
  clearStateOnSwitch?: boolean; // Clear selected project, close popup

  // AI : City metadata (required if updateSelectedCity = true)
  cityName?: string;
  cityNameLocal?: string | null;
  cityCountryCode?: string;
}

/**
 * AI : Result of city data fetch
 */
export interface CityData {
  overlays: OverlayData[];
  projects: any[]; // Project data from backend
  fromCache: boolean; // Indicates if data came from cache
}

/**
 * AI : Map to track pending requests for deduplication
 * AI : Key format: "cityId:mode"
 * AI : Prevents parallel fetches for the same city in the same mode
 */
const pendingRequests = new Map<string, Promise<CityData>>();

/**
 * AI : Fetch city data (overlays + projects) with deduplication and caching
 * AI : This is the unified data fetching function that replaces:
 * AI : - fetchCityDataForViewport (fetch without side effects)
 * AI : - loadCityProjects (fetch with selection update)
 * AI : - loadCityProjectsForViewport (fetch for viewport without selection)
 *
 * @param options - Fetch options controlling behavior
 * @returns CityData with overlays and projects
 */
export async function fetchCityData(options: FetchCityDataOptions): Promise<CityData> {
  const {
    cityId,
    forceRefresh = false,
    updateSelectedCity = false,
    clearStateOnSwitch = false,
    cityName,
    cityNameLocal,
    cityCountryCode,
  } = options;

  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();
  const currentMode = overlayStore.mode;

  // AI : Validate: if updateSelectedCity is true, city metadata must be provided
  if (updateSelectedCity && (!cityName || !cityCountryCode)) {
    throw new Error(
      "fetchCityData: cityName and cityCountryCode are required when updateSelectedCity is true",
    );
  }

  // AI : SIDE EFFECT 1: Update selected city in store
  if (updateSelectedCity && cityName && cityCountryCode) {
    const uiStore = useUiStore();
    const previousCityId = mapStore.selectedCity?.id;
    const isSwitchingCity = previousCityId !== cityId;

    mapStore.setSelectedCity({
      id: cityId,
      name: cityName,
      nameLocal: cityNameLocal ?? null,
      countryCode: cityCountryCode,
    });

    // AI : SIDE EFFECT 2: Clear state when switching cities (if requested)
    if (clearStateOnSwitch && isSwitchingCity) {
      const { selectedProjectId } = useSelectedProject();
      selectedProjectId.value = null;
      uiStore.closeProjectInfoPopup();
    }
  }

  // AI : Generate deduplication key
  const cacheKey = `${cityId}:${currentMode}`;

  // AI : REQUEST DEDUPLICATION: Return existing promise if fetch is in progress
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  // AI : Start new fetch operation
  const fetchPromise = (async () => {
    try {
      // AI : Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cachedOverlays = mapStore.getCityOverlaysAndProjectsCache(cityId, currentMode);
        const cachedProjects = mapStore.getCityStandaloneProjectsCache(cityId, currentMode);

        // AI : If both are cached, return immediately
        if (cachedOverlays && cachedProjects) {
          return {
            overlays: cachedOverlays,
            projects: cachedProjects,
            fromCache: true,
          };
        }
      }

      // AI : Fetch data in parallel for better performance
      const [overlaysData, projectsData] = await Promise.all([
        // AI : Fetch overlays (or use cache if available and not force refresh)
        (async () => {
          if (!forceRefresh) {
            const cached = mapStore.getCityOverlaysAndProjectsCache(cityId, currentMode);
            if (cached) return cached;
          }
          const data = await fetchCityProjectsData(cityId);
          mapStore.setCityProjectsCache(cityId, currentMode, data);
          return data;
        })(),

        // AI : Fetch standalone projects (or use cache if available and not force refresh)
        (async () => {
          if (!forceRefresh) {
            const cached = mapStore.getCityStandaloneProjectsCache(cityId, currentMode);
            if (cached) return cached;
          }
          const data = await trpc.project.getCityProjects.query({ cityId, mode: currentMode });
          mapStore.setCityStandaloneProjectsCache(cityId, currentMode, data);
          return data;
        })(),
      ]);

      return {
        overlays: overlaysData,
        projects: projectsData,
        fromCache: false,
      };
    } finally {
      // AI : Clean up pending request after completion
      pendingRequests.delete(cacheKey);
    }
  })();

  // AI : Store promise for deduplication
  pendingRequests.set(cacheKey, fetchPromise);

  return fetchPromise;
}
