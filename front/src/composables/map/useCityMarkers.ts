import L from "leaflet";
import { ref, watch } from "vue";
import { t } from "@/locales";
import { map } from "@/composables/core/useMap";
import { mobileAwareFlyTo } from "@/composables/map/useMapNavigation";
import { useSelectedProject } from "@/composables/project/useProjectSelection";
import { loadAndRenderCityData } from "@/composables/navigation/useCityDataRenderer";
import type { RouterOutput } from "@/client";

import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { MARKER_OPACITY } from "@/constants/markerConstants";
import { createColorIcon } from "@/composables/map/useMarkers";
import {
  updateStandaloneProjectMarkerOpacities,
  updateAllStandaloneProjectMarkerColors,
} from "@/composables/map/useStandaloneProjectMarkers";
import { cleanupProjectInfoTeleportTarget } from "@/composables/map/useProjectPopupTeleport";
import { useAccordionState } from "@/composables/layout/useAccordionState";

// AI : Type aliases using RouterOutput from tRPC
export type CityWithProjects = RouterOutput["cities"]["getCitiesWithProjects"][number];

// AI : Cities with projects data
export const citiesWithProjects = ref<CityWithProjects[]>([]);

// AI : Module-level state moved to cityMarkersStore for HMR safety
// AI : Access via useCityMarkersStore() instead of direct variables

/**
 * AI : Helper function to augment city list with cities from locally created projects
 * AI : This ensures cities with only local/pending projects appear in city markers
 */
function augmentCitiesWithLocalProjects(cities: CityWithProjects[]): CityWithProjects[] {
  const projectStore = useProjectStore();
  const authStore = useAuthStore();

  // AI : Include both local (unsaved) and user's pending projects
  const userProjectsToInclude = Object.values(projectStore.projects).filter((p) => {
    // AI : Local projects (not yet submitted)
    if (p.status === null || p.status === undefined) return true;

    // AI : User's own pending projects (submitted but not approved)
    if (p.status === "pending" && authStore.user && p.ownerId === authStore.user.id) return true;

    return false;
  });

  if (userProjectsToInclude.length === 0) {
    return cities;
  }

  // AI : Build a map of city IDs from user projects
  const localProjectCitiesMap = new Map<number, CityWithProjects>();

  for (const project of userProjectsToInclude) {
    if (project.city && project.cityId) {
      // AI : Only add to map if not already present
      if (!localProjectCitiesMap.has(project.cityId)) {
        localProjectCitiesMap.set(project.cityId, {
          id: project.cityId,
          name: project.city.name,
          nameLocal: project.city.nameLocal ?? null,
          lat: project.city.coordinates.y,
          lng: project.city.coordinates.x,
          countryCode: project.city.countryCode,
          projectCount: 0, // AI : Local projects, count doesn't matter for display
        });
      }
    }
  }

  // AI : Add cities from local projects that aren't already in the city list
  const existingCityIds = new Set(cities.map((c) => c.id));
  const additionalCities: CityWithProjects[] = [];

  for (const [cityId, cityData] of localProjectCitiesMap) {
    if (!existingCityIds.has(cityId)) {
      additionalCities.push(cityData);
    }
  }

  return additionalCities.length > 0 ? [...cities, ...additionalCities] : cities;
}

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

      // AI : City marker visibility rules:
      // AI : - View mode: cities with approved content
      // AI : - Edit mode: view + cities with user's pending contributions
      // AI : - Moderation mode: view + cities with anyone's pending contributions
      // AI : Each mode is ADDITIVE - we need to merge view mode (base) with mode-specific cities

      const projectStore = useProjectStore();

      try {
        // AI : Always start with view mode cities as the base (approved content)
        const viewCities = await projectStore.fetchCitiesWithProjects("view");

        if (newMode === "view" || !authStore.isAuthenticated) {
          // AI : View mode: just use view cities
          citiesWithProjects.value = viewCities;
        } else {
          // AI : Edit or Moderation mode: merge view cities with mode-specific cities
          const modeCities = await projectStore.fetchCitiesWithProjects(newMode);

          // AI : Merge: start with view cities, add any mode-specific cities not already included
          const viewCityIds = new Set(viewCities.map((c) => c.id));
          const additionalCities = modeCities.filter((c) => !viewCityIds.has(c.id));
          let mergedCities = [...viewCities, ...additionalCities];

          // AI : In edit mode, also include cities from locally created projects
          if (newMode === "edit") {
            mergedCities = augmentCitiesWithLocalProjects(mergedCities);
          }

          citiesWithProjects.value = mergedCities;
        }

        // AI : Re-render all city markers with merged data
        // AI : CRITICAL FIX: Mode watcher should ALWAYS render all cities, not filter by selectedCountryCode
        // AI : Country filtering should only happen when explicitly navigating to a country (via addCityMarkersForCountry)
        // AI : The mode watcher's job is to refresh city data for the new mode, not to apply country filters
        addCityMarkersToMapInternal(citiesWithProjects.value);
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
function updateCityMarkerOpacities(selectedCityId: number | null): void {
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
 * AI : Close project popup and reset standalone project marker opacities
 * This extends the base cleanup with marker opacity reset specific to city markers
 */
export function closeProjectPopupAndResetMarkers() {
  cleanupProjectInfoTeleportTarget();
  updateStandaloneProjectMarkerOpacities(null); // AI : Reset marker opacities when popup closes
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
    if (!cityId) return;

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
  } catch (error) {
    console.error("Error loading city projects:", error);
  }
}

/**
 * AI : Remove city markers from the map
 * AI : NOTE: This does NOT remove standalone project markers - they are managed separately
 * AI : Standalone project markers persist across city marker reloads and are only cleared when changing cities
 */
export function removeCityMarkers(): void {
  const cityMarkersStore = useCityMarkersStore();
  const cityMarkersLayer = cityMarkersStore.getCityMarkersLayer();

  if (cityMarkersLayer && map.value !== null && map.value.hasLayer(cityMarkersLayer)) {
    map.value.removeLayer(cityMarkersLayer);
    cityMarkersStore.setCityMarkersLayer(null);
  }

  cityMarkersStore.clearCityMarkerMap();
  // AI : Don't clear unsaved city markers - they should persist across country switches
  // AI : and will be filtered by country when displayed via addCityMarkersToMapInternal
}

/**
 * AI : Create a layer group with city markers
 * AI : Handles all city-specific marker creation, event handling, and state management
 */
function createCitiesMarkerLayer(cities: CityWithProjects[]): {
  layer: L.LayerGroup;
  markers: Map<string, L.Marker>;
} {
  const layer = L.layerGroup();
  const markers = new Map<string, L.Marker>();

  const defaultOpacity = MARKER_OPACITY.city.default;
  const hoverOpacity = MARKER_OPACITY.city.hover;

  // AI : Helper to reset all markers to default opacity
  function resetAllMarkerOpacities() {
    layer.eachLayer((l) => {
      if (l instanceof L.Marker) {
        l.setOpacity(defaultOpacity);
      }
    });
  }

  for (const city of cities) {
    // AI : Create marker with blue icon
    const marker = L.marker([city.lat, city.lng], {
      icon: createColorIcon("blue"),
      opacity: defaultOpacity,
    });

    // AI : Bind tooltip
    const tooltipText = city.nameLocal ? `${city.name} (${city.nameLocal})` : city.name;
    marker.bindTooltip(tooltipText, { permanent: false });

    // AI : Set up data attributes after marker is added to DOM
    marker.on("add", () => {
      const markerElement = marker.getElement();
      if (markerElement) {
        markerElement.setAttribute("data-testid", `city-marker-${city.id}`);
        markerElement.setAttribute("data-city-id", String(city.id));
        markerElement.setAttribute("data-city-name", city.name);
        markerElement.setAttribute("data-city-name-local", city.nameLocal ?? "");
        markerElement.setAttribute("data-country-code", city.countryCode);
        markerElement.setAttribute("data-lat", city.lat.toString());
        markerElement.setAttribute("data-lng", city.lng.toString());
      }
    });

    // AI : Prevent double-click zoom on markers
    marker.on("dblclick", (e) => {
      L.DomEvent.stopPropagation(e);
    });

    // AI : Hover event - increase opacity (respects selected state)
    marker.on("mouseover", () => {
      marker.setOpacity(hoverOpacity);
    });

    // AI : Mouse out event - reset opacity if not selected
    marker.on("mouseout", () => {
      const mapStore = useMapStore();
      const isSelectedCity = mapStore.selectedCity?.id === city.id;
      marker.setOpacity(isSelectedCity ? hoverOpacity : defaultOpacity);
    });

    // AI : Click event - load city data
    marker.on("click", async (e) => {
      L.DomEvent.stopPropagation(e);

      const mapStore = useMapStore();
      const overlayStore = useOverlayStore();

      // AI : Check for unsaved overlays before loading city
      const hasUnsavedOverlays = Object.values(overlayStore.overlays).some(
        (overlay) => overlay.isModified === true,
      );

      if (hasUnsavedOverlays) {
        const isSwitchingCity = mapStore.selectedCity?.id !== city.id;
        const message = isSwitchingCity
          ? t("navigation.unsavedOverlaysSwitchCity")
          : t("navigation.unsavedOverlaysReloadCity");

        const confirmed = confirm(message);
        if (!confirmed) return;
      }

      // AI : Reset all markers and highlight this one
      resetAllMarkerOpacities();
      marker.setOpacity(hoverOpacity);

      // AI : Update selected city in store
      mapStore.setSelectedCity({
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode,
      });

      // AI : Request scroll to city in adjacent panels
      const { requestScrollTo } = useAccordionState();
      requestScrollTo("city", city.id);

      // AI : Load city data before flight animation
      await loadAndRenderCityData(city.id, true);

      // AI : Zoom to city marker
      if (map.value && map.value.getZoom() < 14) {
        mobileAwareFlyTo([city.lat, city.lng], 14, { duration: 1.5 });
      } else if (map.value) {
        mobileAwareFlyTo([city.lat, city.lng], map.value.getZoom(), { duration: 0.5 });
      }
    });

    // AI : Store marker and add to layer
    markers.set(String(city.id), marker);
    marker.addTo(layer);
  }

  return { layer, markers };
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

  // AI : Create marker using createCitiesMarkerLayer
  const cityData: CityWithProjects = { ...city, projectCount: 0 };
  const result = createCitiesMarkerLayer([cityData]);

  // AI : Add marker to existing layer
  for (const [cityId, marker] of result.markers) {
    cityMarkersLayer?.addLayer(marker);
    cityMarkersStore.setCityMarker(cityId, marker);
  }

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
    const projectStore = useProjectStore();

    // AI : City marker visibility rules:
    // AI : - View mode: cities with approved content
    // AI : - Edit mode: view + cities with user's pending contributions
    // AI : - Moderation mode: view + cities with anyone's pending contributions
    // AI : Each mode is ADDITIVE - we need to merge view mode (base) with mode-specific cities

    // AI : Always start with view mode cities as the base (approved content)
    const viewCities = await projectStore.fetchCitiesWithProjects("view");

    const currentMode = authStore.isAuthenticated ? overlayStore.mode : "view";
    let citiesData = viewCities;

    if (currentMode !== "view" && authStore.isAuthenticated) {
      // AI : Edit or Moderation mode: merge view cities with mode-specific cities
      const modeCities = await projectStore.fetchCitiesWithProjects(currentMode);

      // AI : Merge: start with view cities, add any mode-specific cities not already included
      const viewCityIds = new Set(viewCities.map((c) => c.id));
      const additionalCities = modeCities.filter((c) => !viewCityIds.has(c.id));
      let mergedCities = [...viewCities, ...additionalCities];

      // AI : In edit mode, also include cities from locally created projects
      if (currentMode === "edit") {
        mergedCities = augmentCitiesWithLocalProjects(mergedCities);
      }

      citiesData = mergedCities;
    }

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

  // AI : OPTIMIZATION: Check if we really need to update markers
  // AI : Compare currently rendered city IDs with new city IDs
  const currentMarkerMap = cityMarkersStore.getAllCityMarkers();
  const currentCityIds = new Set(currentMarkerMap.keys());
  const newCityIds = new Set(citiesToRender.map((c) => String(c.id)));

  // AI : Check for sets equality (same size, same content)
  const needsUpdate =
    currentCityIds.size !== newCityIds.size ||
    ![...newCityIds].every((id) => currentCityIds.has(id));

  // AI : Also check if the layer exists
  if (!needsUpdate && cityMarkersLayer && map.value.hasLayer(cityMarkersLayer)) {
    // AI : No update needed, return early
    return;
  }

  // AI : Remove existing layer to prevent stacking
  if (cityMarkersLayer) {
    map.value.removeLayer(cityMarkersLayer);
  }

  // AI : Create markers using createCitiesMarkerLayer
  const result = createCitiesMarkerLayer(citiesToRender);
  cityMarkersLayer = result.layer;
  cityMarkersStore.setCityMarkersLayer(cityMarkersLayer);

  // AI : Store markers for lookup
  cityMarkersStore.clearCityMarkerMap();

  for (const [cityId, marker] of result.markers) {
    cityMarkersStore.setCityMarker(cityId, marker);
  }

  // AI : Initialize watcher and add to map
  initializeCityMarkerWatcher();
  cityMarkersLayer.addTo(map.value);

  // AI : Update opacities for selected city
  const mapStore = useMapStore();
  if (mapStore.selectedCity) {
    updateCityMarkerOpacities(mapStore.selectedCity.id);
  }
}
