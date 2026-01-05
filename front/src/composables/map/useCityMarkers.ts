import L from "leaflet";
import { createStandaloneProjectIcon } from "@/composables/map/useMarkers";
import type { Project } from "@/types/index";
import { ref, watch } from "vue";
import { t } from "@/locales";
import { map } from "@/composables/core/useMap";
import { mobileAwareFlyTo } from "@/composables/map/useMapNavigation";
import { useSelectedProject } from "@/composables/project/useProjectSelection";
import type { RouterOutput } from "@/client";

import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { useCompletionFilters } from "@/composables/overlay/useCompletionFilters";
import { useProjects } from "@/composables/project/useProjects";
import { createProjectObject } from "../../utils/typeFactories";
import { getProjectMarkerColor } from "../../utils/markerColors";
import { MARKER_OPACITY } from "@/constants/markerConstants";
import { createMarkerLayer, type MarkerLayerConfig } from "@/composables/map/useMarkerLayer";
import {
  addStandaloneProjectMarkerForProject,
  getStandaloneProjectMarkerByProjectId,
  getStandaloneProjectMarkerMap,
  updateStandaloneProjectMarkerOpacities,
  updateStandaloneProjectMarkerTooltip,
  clearAllStandaloneProjectMarkers,
} from "@/composables/map/useStandaloneProjectMarkers";
import { cleanupProjectInfoTeleportTarget } from "@/composables/map/useProjectPopupTeleport";

// AI : Type aliases using RouterOutput from tRPC
export type CityWithProjects = RouterOutput["cities"]["getCitiesWithProjects"][number];

// AI : Cities with projects data
export const citiesWithProjects = ref<CityWithProjects[]>([]);

// AI : Module-level state moved to cityMarkersStore for HMR safety
// AI : Access via useCityMarkersStore() instead of direct variables

/**
 * AI : Initialize mode change watcher (called lazily on first use)
 * This handles both switchMode() and direct setMode() calls (like from side menu)
 */
function initializeModeWatcher() {
  const cityMarkersStore = useCityMarkersStore();
  if (cityMarkersStore.isModeWatcherInitialized()) return;

  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();

  watch(
    () => overlayStore.mode,
    async (newMode, oldMode) => {
      // AI : Guard: only reload if mode actually changed
      if (newMode === oldMode) {
        return;
      }
      updateAllStandaloneProjectMarkerColors();

      // AI : Re-fetch city markers with the new mode filter
      // AI : This ensures cities with ONLY pending content appear when switching to edit mode
      const queryMode = authStore.isAuthenticated ? newMode : "view";
      const projectStore = useProjectStore(); // AI : Use projectStore

      try {
        const citiesData = await projectStore.fetchCitiesWithProjects(queryMode);

        if (citiesData && citiesData.length > 0) {
          // AI : Update global ref
          citiesWithProjects.value = citiesData;

          // AI : Re-render city markers with new data
          const mapStore = useMapStore();
          if (mapStore.selectedCountryCode) {
            // AI : If viewing a specific country, filter to that country
            const countryCities = citiesData.filter(
              (c) => c.countryCode === mapStore.selectedCountryCode,
            );
            addCityMarkersForCountry(countryCities, mapStore.selectedCountryCode);
          } else {
            // AI : Otherwise show all cities
            addCityMarkersToMapInternal(citiesData);
          }
        }
      } catch (error) {
        console.error("Error reloading city markers on mode change:", error);
      }
    },
  );

  cityMarkersStore.setModeWatcherInitialized(true);
}

/**
 * AI : Initialize selectedCity watcher to update city marker opacity
 * This makes the selected city marker opaque when navigating from panels
 */
function initializeCityMarkerWatcher() {
  const cityMarkersStore = useCityMarkersStore();
  if (cityMarkersStore.isCityMarkerWatcherInitialized()) return;

  const mapStore = useMapStore();
  watch(
    () => mapStore.selectedCity,
    (selectedCity) => {
      updateCityMarkerOpacities(selectedCity?.id ?? null);
    },
  );

  cityMarkersStore.setCityMarkerWatcherInitialized(true);
}

/**
 * AI : Update city marker opacities based on selected city
 */
export function updateCityMarkerOpacities(selectedCityId: number | null): void {
  const cityMarkersStore = useCityMarkersStore();
  const cityMarkersLayer = cityMarkersStore.getCityMarkersLayer();
  if (!cityMarkersLayer) return;

  cityMarkersLayer.eachLayer((layer) => {
    if (layer instanceof L.Marker) {
      const markerElement = layer.getElement();
      const cityId = markerElement?.getAttribute("data-city-id");

      if (selectedCityId && Number(cityId) === selectedCityId) {
        layer.setOpacity(MARKER_OPACITY.city.hover);
      } else {
        layer.setOpacity(MARKER_OPACITY.city.default);
      }
    }
  });
}

/**
 * AI : Update standalone project marker color for a specific project
 */
export function updateStandaloneProjectMarkerColor(projectId: string, project: Project): void {
  const marker = getStandaloneProjectMarkerByProjectId(projectId);
  if (!marker) return;

  const overlayStore = useOverlayStore();
  const markerColor = getProjectMarkerColor(project, overlayStore.mode);
  const markerIcon = createStandaloneProjectIcon(markerColor);
  marker.setIcon(markerIcon);
}

export function updateAllStandaloneProjectMarkerColors(): void {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const markerMap = getStandaloneProjectMarkerMap();

  markerMap.forEach((marker, projectId) => {
    // AI : Try to find project in multiple locations:
    // 1. projectStore.projects (local/cached projects)
    // 2. projectStore.allProjects (fetched projects)
    // 3. MapStore's standalone projects cache (for current city)
    let project: Project | undefined =
      projectStore.projects[projectId] ?? projectStore.allProjects[projectId];

    if (!project && mapStore.selectedCity) {
      // AI : Fallback: check the cached standalone projects for this city
      const cachedStandaloneProjects = mapStore.getCityStandaloneProjectsCache(
        mapStore.selectedCity.id,
        overlayStore.mode,
      );
      project = cachedStandaloneProjects?.find((p) => p.id === projectId) as Project | undefined;
    }

    if (project) {
      const markerColor = getProjectMarkerColor(project, overlayStore.mode);
      const markerIcon = createStandaloneProjectIcon(markerColor);
      marker.setIcon(markerIcon);

      // AI : Also update tooltip when mode changes
      updateStandaloneProjectMarkerTooltip(marker, project, overlayStore.mode);
    }
  });
}

/**
 * AI : Close project popup and reset standalone project marker opacities
 * This extends the base cleanup with marker opacity reset specific to city markers
 */
export function closeProjectPopupAndResetMarkers() {
  cleanupProjectInfoTeleportTarget();
  updateStandaloneProjectMarkerOpacities(null); // AI : Reset marker opacities when popup closes
}

/**
 * AI : Load projects without overlays (standalone project markers) for a specific city and display them on map
 */
/**
 * AI : Load projects without overlays (standalone project markers) for a specific city and display them on map
 */
export async function loadCityStandaloneProjects(cityId: number | null): Promise<void> {
  if (!map.value) return;

  initializeModeWatcher();

  // AI : Clear all existing standalone project markers to prevent accumulation across cities
  clearAllStandaloneProjectMarkers();

  try {
    const mapStore = useMapStore();
    const overlayStore = useOverlayStore();
    const projectStore = useProjectStore(); // AI : Use projectStore

    let backendProjects: RouterOutput["project"]["getCityProjects"] = [];
    if (cityId) {
      const cachedData = mapStore.getCityStandaloneProjectsCache(cityId, overlayStore.mode);
      if (cachedData) {
        backendProjects = cachedData;
      } else {
        // AI : Use projectStore action
        backendProjects = await projectStore.fetchCityStandaloneProjects(cityId, overlayStore.mode);
        mapStore.setCityStandaloneProjectsCache(cityId, overlayStore.mode, backendProjects);
      }
    }

    // AI : Don't filter by overlayCount here - rejected overlays aren't rendered but still count
    // AI : Instead, rely on the check below that skips projects with rendered overlays
    const backendProjectsWithNoOverlays = backendProjects;

    const { projects: localProjects } = useProjects();
    const allLocalProjects = Object.values(localProjects.value);
    const authStore = useAuthStore();

    const localProjectsWithNoOverlays = allLocalProjects.filter((project) => {
      const overlayCount = project.overlayIds?.length ?? 0;
      const matchesCity =
        project.cityId === cityId ||
        (cityId === null && (project.cityId === null || project.cityId === undefined));

      // AI : Filter by mode and status (same logic as backend)
      let matchesVisibilityFilter = false;
      if (overlayStore.mode === "view") {
        // AI : View mode: only show approved projects
        matchesVisibilityFilter = project.status === "approved";
      } else if (overlayStore.mode === "edit" && authStore.user) {
        // AI : Edit mode: show approved projects OR user's own projects
        matchesVisibilityFilter =
          project.status === "approved" || project.ownerId === authStore.user.id;
      } else if (overlayStore.mode === "moderation") {
        // AI : Moderation mode: show approved OR pending projects
        matchesVisibilityFilter = project.status === "approved" || project.status === "pending";
      } else {
        // AI : Default: only show approved
        matchesVisibilityFilter = project.status === "approved";
      }

      return overlayCount === 0 && matchesCity && matchesVisibilityFilter;
    });

    const allProjectsWithNoOverlays = [
      ...backendProjectsWithNoOverlays,
      ...localProjectsWithNoOverlays.filter(
        (local) => !backendProjectsWithNoOverlays.some((backend) => backend.id === local.id),
      ),
    ];

    // AI : Get set of project IDs that have overlays (either rendered in store OR in city overlay data)
    // AI : This prevents showing standalone project markers for projects that have overlays
    // AI : We check BOTH sources because:
    // AI : - overlayStore.overlays: contains rendered overlays (high zoom)
    // AI : - mapStore.currentCityOverlays: contains overlay data even when only showing markers (low zoom)
    const projectIdsFromRenderedOverlays = Object.values(overlayStore.overlays)
      .map((overlay) => overlay.projectId)
      .filter((id): id is string => id !== null && id !== undefined);

    const projectIdsFromCityOverlays = mapStore.currentCityOverlays
      .map((overlay) => overlay.projectId)
      .filter((id): id is string => id !== null && id !== undefined);

    const projectIdsWithOverlays = new Set([
      ...projectIdsFromRenderedOverlays,
      ...projectIdsFromCityOverlays,
    ]);

    allProjectsWithNoOverlays.forEach((project) => {
      // AI : Skip if project has overlays (rendered or in city data)
      if (projectIdsWithOverlays.has(project.id)) {
        return;
      }

      if (project.lat && project.lng) {
        const projectData =
          "overlayIds" in project
            ? project
            : createProjectObject({
                ...project,
                city: project.city,
                status: "status" in project ? project.status : "approved",
              });

        // AI : Add project to store so it can be edited
        // AI : We invoke updateProject to ensure reactivity and consistency
        // AI : But we can't accidentally overwrite existing data if we're not careful
        // AI : For now, manually merging as before is safer
        const { projects: localProjects } = useProjects();
        if (!localProjects.value[project.id]) {
          localProjects.value = {
            ...localProjects.value,
            [project.id]: projectData,
          };
        }

        // AI : Apply completion filters (timeline filters in view mode)
        // AI : In edit/moderation modes, timeline filters don't apply
        if (overlayStore.mode === "view") {
          const completionFilters = useCompletionFilters();
          const projectColor = getProjectMarkerColor(projectData, overlayStore.mode);

          // AI : Check if this color is in the completion filters (some colors like 'gold', 'black' may not be)
          const colorKey =
            projectColor as keyof typeof completionFilters.visibleCompletionStates.value;
          const isVisibleByCompletionFilter =
            colorKey in completionFilters.visibleCompletionStates.value
              ? completionFilters.visibleCompletionStates.value[colorKey]
              : true; // AI : If color not in filters, show by default

          if (!isVisibleByCompletionFilter) {
            return;
          }
        }

        addStandaloneProjectMarkerForProject(projectData);
      }
    });
  } catch (error) {
    console.error("Error loading standalone projects:", error);
  }
}

/**
 * AI : Load projects for a specific city and display overlays on map
 */
export async function loadCityProjects(
  cityId: number | null,
  cityName: string,
  nameLocal: string | null,
  forceFullLoad = false,
  cityCountryCode?: string,
): Promise<void> {
  try {
    // AI : Update selected city in store (only if cityId is not null)
    if (cityId) {
      const mapStore = useMapStore();
      const uiStore = useUiStore();

      // AI : Check if we're switching to a different city
      const previousCityId = mapStore.selectedCity?.id;
      const isSwitchingCity = previousCityId !== cityId;

      mapStore.setSelectedCity({
        id: cityId,
        name: cityName,
        nameLocal,
        countryCode: cityCountryCode,
      });

      // AI : Only clear state when actually switching cities, not when refreshing
      if (isSwitchingCity) {
        // AI : Clear selected project when switching cities
        const { selectedProjectId } = useSelectedProject();
        selectedProjectId.value = null;

        // AI : Close project info popup when switching cities
        uiStore.closeProjectInfoPopup();
      }

      // AI : Load overlay projects FIRST, then standalone projects SEQUENTIALLY
      // AI : This prevents race condition where standalone markers appear briefly for projects
      // AI : that have overlays (standalone loader checks overlayStore.overlays which must be populated first)
      // AI : Pass isSwitchingCity flag to avoid clearing overlays when navigating within same city

      // AI : REFACTOR: We no longer load data directly here.
      // AI : The ViewportContentManager listens to 'moveend' (triggered by flyTo operations)
      // AI : and automatically loads the data for the city we are navigating to.
      // AI : This prevents duplicate backend calls.

      // await loadCityOverlays(cityId, forceFullLoad, isSwitchingCity);
      // await loadCityStandaloneProjects(cityId);
    } else {
      // AI : Just load local standalone projects when no city is selected
      // AI : REFACTOR: Viewport manager handles clearing/spatial loading
      // await loadCityStandaloneProjects(null);
    }
  } catch (error) {
    console.error("Error loading city projects:", error);
  }
}

/**
 * AI : Clear unsaved city markers (called when switching countries)
 */
export function clearUnsavedCityMarkers(): void {
  const cityMarkersStore = useCityMarkersStore();
  cityMarkersStore.unsavedCityMarkers.clear();
}

/**
 * AI : Remove city markers from the map
 * AI : NOTE: This does NOT remove standalone project markers - they are managed separately
 * AI : Standalone project markers persist across city marker reloads and are only cleared when changing cities
 */
export function removeCityMarkers(): void {
  const cityMarkersStore = useCityMarkersStore();
  const cityMarkersLayer = cityMarkersStore.getCityMarkersLayer();

  if (cityMarkersLayer && map.value != null && map.value.hasLayer(cityMarkersLayer)) {
    map.value.removeLayer(cityMarkersLayer);
    cityMarkersStore.setCityMarkersLayer(null);
  }

  cityMarkersStore.clearCityMarkerMap();
  // AI : Don't clear unsaved city markers - they should persist across country switches
  // AI : and will be filtered by country when displayed via addCityMarkersToMapInternal
}

/**
 * AI : Shared city marker configuration to avoid code duplication
 */
function getCityMarkerConfig(): MarkerLayerConfig<CityWithProjects> {
  return {
    getOpacity: (hover) => (hover ? MARKER_OPACITY.city.hover : MARKER_OPACITY.city.default),
    getColor: () => "blue",
    getLatLng: (city) => ({ lat: city.lat, lng: city.lng }),
    getTooltip: (city) => (city.nameLocal ? `${city.name} (${city.nameLocal})` : city.name),
    getTestId: (city) => `city-marker-${city.id}`,
    getDataAttributes: (city) => ({
      "data-city-id": String(city.id),
      "data-city-name": city.name,
      "data-city-name-local": city.nameLocal ?? "",
      "data-country-code": city.countryCode,
      "data-lat": city.lat.toString(),
      "data-lng": city.lng.toString(),
    }),
    onMarkerHover: (marker, city, isHovering) => {
      // AI : Custom hover handler that respects selected city state
      const mapStore = useMapStore();
      const isSelectedCity = mapStore.selectedCity?.id === city.id;

      if (isHovering) {
        // AI : Always increase opacity on hover
        marker.setOpacity(MARKER_OPACITY.city.hover);
      } else if (isSelectedCity) {
        // AI : On mouse out, keep opacity high if this is the selected city
        marker.setOpacity(MARKER_OPACITY.city.hover);
      } else {
        marker.setOpacity(MARKER_OPACITY.city.default);
      }
    },
    onMarkerClick: async (_marker, city) => {
      const mapStore = useMapStore();
      const overlayStore = useOverlayStore();

      // AI : Check for unsaved overlays before loading city (same city or different)
      const hasUnsavedOverlays = Object.values(overlayStore.overlays).some(
        (overlay) => overlay.isModified === true,
      );

      if (hasUnsavedOverlays) {
        const isSwitchingCity = mapStore.selectedCity?.id !== city.id;
        const message = isSwitchingCity
          ? t("navigation.unsavedOverlaysSwitchCity")
          : t("navigation.unsavedOverlaysReloadCity");

        const confirmed = confirm(message);
        if (!confirmed) {
          return; // AI : User cancelled
        }
      }

      // AI : Update selected city in store
      mapStore.setSelectedCity({
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode,
      });

      // AI : Zoom to the city marker position
      if (map.value && map.value.getZoom() < 14) {
        mobileAwareFlyTo([city.lat, city.lng], 14, {
          duration: 1.5,
        });
        // AI : moveend event will trigger viewport refresh automatically
      } else {
        // AI : Already at zoom 14+, no zoom will happen
        // AI : Trigger a tiny pan to fire moveend event which will load content
        // AI : This avoids circular dependency from importing useViewportContentManager
        if (map.value) {
          const center = map.value.getCenter();
          // AI : Pan by 0.00001 degrees (imperceptible) to trigger moveend
          map.value.panTo([center.lat + 0.00001, center.lng], { animate: false });
        }
      }
    },
  };
}

/**
 * AI : Add a single city marker without replacing existing ones
 */
export function addSingleCityMarker(
  city: {
    id: number;
    name: string;
    nameLocal: string | null;
    lat: number;
    lng: number;
    countryCode: string;
  },
  isUnsaved = false,
): void {
  if (!map.value) {
    console.error("Map not initialized when trying to add city marker");
    return;
  }

  const cityMarkersStore = useCityMarkersStore();

  // AI : Don't add if marker already exists
  if (cityMarkersStore.getCityMarker(String(city.id))) return;

  // AI : Initialize layer if needed
  let cityMarkersLayer = cityMarkersStore.getCityMarkersLayer();
  if (!cityMarkersLayer) {
    cityMarkersLayer = L.layerGroup().addTo(map.value);
    cityMarkersStore.setCityMarkersLayer(cityMarkersLayer);
    initializeCityMarkerWatcher();
  }

  // AI : Use shared config to create marker
  const config = getCityMarkerConfig();
  const cityData: CityWithProjects = { ...city, projectCount: 0 };
  const result = createMarkerLayer([cityData], config);

  // AI : Add marker to existing layer
  result.markers.forEach((marker, cityId) => {
    marker.addTo(cityMarkersLayer!);
    cityMarkersStore.setCityMarker(cityId, marker);
  });

  // AI : Track if this is an unsaved city marker
  if (isUnsaved) {
    cityMarkersStore.setUnsavedCityMarker(city.id, {
      name: city.name,
      nameLocal: city.nameLocal,
      lat: city.lat,
      lng: city.lng,
      countryCode: city.countryCode,
    });
  }
}

/**
 * AI : Load and display all city markers globally (for viewport-based loading)
 * AI : Fetches all cities with projects worldwide and displays them on the map
 */
export async function loadAllCityMarkersGlobally(): Promise<CityWithProjects[]> {
  if (!map.value) {
    console.error("Map not initialized when trying to load global city markers");
    return [];
  }

  try {
    const overlayStore = useOverlayStore();
    const authStore = useAuthStore();
    const projectStore = useProjectStore(); // AI : Use projectStore

    // AI : For unauthenticated users, ensure we always use 'view' mode
    const queryMode = authStore.isAuthenticated ? overlayStore.mode : "view";

    // AI : Fetch all cities with projects globally (no countryCode filter)
    const citiesData = await projectStore.fetchCitiesWithProjects(queryMode);

    if (citiesData && citiesData.length > 0) {
      // AI : Store in global ref for viewport detection
      citiesWithProjects.value = citiesData;

      // AI : Add all city markers to map (without country filter)
      addCityMarkersToMapInternal(citiesData);

      // AI : CRITICAL: Initialize mode watcher so cities re-fetch when mode changes
      // AI : This must be called AFTER initial load to ensure cities with only pending content appear in edit mode
      initializeModeWatcher();

      return citiesData;
    }

    return [];
  } catch (error) {
    console.error("Error loading global city markers:", error);
    return [];
  }
}

/**
 * AI : Add city markers for a specific country
 */
export function addCityMarkersForCountry(cities: CityWithProjects[], countryCode?: string): void {
  if (!map.value) {
    console.error("Map not initialized when trying to add city markers for country");
    return;
  }
  addCityMarkersToMapInternal(cities, countryCode);
}

/**
 * AI : Internal function to add city markers to map
 */
function addCityMarkersToMapInternal(
  cities: CityWithProjects[],
  explicitCountryCode?: string,
): void {
  if (!map.value) return;

  const cityMarkersStore = useCityMarkersStore();
  let cityMarkersLayer = cityMarkersStore.getCityMarkersLayer();

  // AI : Remove existing layer to prevent stacking
  if (cityMarkersLayer) {
    map.value.removeLayer(cityMarkersLayer);
  }

  // AI : Determine country code from explicit parameter or derive from cities
  const countryCode = explicitCountryCode ?? (cities.length > 0 ? cities[0].countryCode : null);

  // AI : Merge backend cities with unsaved city markers for THIS country only
  const unsavedCityMarkersMap = cityMarkersStore.getAllUnsavedCityMarkers();
  const unsavedCities: CityWithProjects[] = [...unsavedCityMarkersMap.entries()]
    .filter(([cityId, cityData]) => {
      // AI : Only include unsaved markers for the current country
      if (countryCode && cityData.countryCode !== countryCode) return false;
      // AI : Don't include if city already exists in backend data
      return !cities.some((c) => c.id === cityId);
    })
    .map(([cityId, cityData]) => Object.assign({ id: cityId, projectCount: 0 }, cityData));

  const allCities = [...cities, ...unsavedCities];

  // AI : Use shared config to create markers
  const config = getCityMarkerConfig();

  // AI : Filter cities for moderation mode if user is restricted
  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();
  let citiesToRender = allCities;

  if (
    overlayStore.mode === "moderation" &&
    authStore.user &&
    authStore.user.role !== "admin" &&
    authStore.user.moderatedCountries
  ) {
    const moderatedCountries = authStore.user.moderatedCountries;
    citiesToRender = citiesToRender.filter((city) => moderatedCountries.includes(city.countryCode));
  }

  const result = createMarkerLayer(citiesToRender, config);
  cityMarkersLayer = result.layer;
  cityMarkersStore.setCityMarkersLayer(cityMarkersLayer);

  // AI : Store markers for lookup
  cityMarkersStore.clearCityMarkerMap();
  result.markers.forEach((marker, cityId) => {
    cityMarkersStore.setCityMarker(cityId, marker);
  });

  // AI : Initialize watcher and add to map
  initializeCityMarkerWatcher();
  cityMarkersLayer.addTo(map.value);

  // AI : Update opacities for selected city
  const mapStore = useMapStore();
  if (mapStore.selectedCity) {
    updateCityMarkerOpacities(mapStore.selectedCity.id);
  }
}
