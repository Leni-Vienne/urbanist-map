import L from "leaflet";
import { ref, watch } from "vue";
import { t } from "@/locales";
import { map } from "@/services/core/map";
import {
  mobileAwareFlyTo,
  mobileAwareFlyToBounds,
  calculateBoundsFromLocations,
} from "@/services/map/mapNavigation";
import { loadAndRenderCityData } from "@/services/navigation/cityDataRenderer";
import type { RouterOutput } from "@/client";

import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { MARKER_OPACITY } from "@/constants/markerConstants";
import { createColorIcon } from "@/services/map/markers";
import { checkAndSwitchSatelliteLayer } from "@/services/map/tileLayers";
import { pruneMapEntities } from "@/services/map/viewportPruning";

import { requestScrollTo } from "@/services/layout/accordionState";

// AI : Type aliases using RouterOutput from tRPC
export type CityWithProjects = RouterOutput["cities"]["getCitiesWithProjects"][number];

// AI : Cities with projects data
export const citiesWithProjects = ref<CityWithProjects[]>([]);

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
            // AI : In edit mode, also include cities from locally created projects
            if (newMode === "edit") {
              mergedCities = projectStore.getMergedCities(mergedCities, authStore.user?.id ?? null);
            }
          }

          citiesWithProjects.value = mergedCities;
        }

        // AI : Re-render all city markers with merged data
        // AI : CRITICAL FIX: Mode watcher should ALWAYS render all cities, not filter by selectedCountryCode
        // AI : Country filtering should only happen when explicitly navigating to a country (via addCityMarkersForCountry)
        // AI : The mode watcher's job is to refresh city data for the new mode, not to apply country filters
        await addCityMarkersToMapInternal(citiesWithProjects.value);
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
 * AI : Remove city markers from the map
 * AI : NOTE: This does NOT remove standalone project markers - they are managed separately
 * AI : Standalone project markers persist across city marker reloads and are only cleared when changing cities
 */
export function removeCityMarkers(): void {
  const cityMarkersStore = useCityMarkersStore();

  // AI : Explicitly remove all markers from map
  const allMarkers = cityMarkersStore.getAllCityMarkers();
  for (const marker of allMarkers.values()) {
    if (map.value && map.value.hasLayer(marker)) {
      marker.remove();
    }
  }

  cityMarkersStore.clearCityMarkerMap();
  // AI : Don't clear unsaved city markers - they should persist across country switches
  // AI : and will be filtered by country when displayed via addCityMarkersToMapInternal
}

/**
 * AI : Smart zoom logic: Fit bounds of all content (center + projects + overlays)
 */
function smartZoomToCity(
  city: { lat: number; lng: number },
  data: Awaited<ReturnType<typeof loadAndRenderCityData>>,
) {
  if (!map.value) return;

  const locations: { lat: number; lng: number }[] = [];

  // AI : Always include city center
  locations.push({ lat: city.lat, lng: city.lng });

  if (data) {
    const { overlays, projects } = data;

    // AI : Add standalone projects
    if (projects) {
      locations.push(
        ...projects
          .filter(
            (p): p is typeof p & { lat: number; lng: number } =>
              typeof p.lat === "number" && typeof p.lng === "number",
          )
          .map((p) => ({ lat: p.lat, lng: p.lng })),
      );
    }

    // AI : Add overlay corners
    if (overlays) {
      for (const o of overlays) {
        if (Array.isArray(o.corners)) {
          locations.push(
            ...o.corners.filter(
              (c: any) => c && typeof c.lat === "number" && typeof c.lng === "number",
            ),
          );
        }
      }
    }
  }

  const bounds = calculateBoundsFromLocations(locations);

  // AI : Identify if we have significant content spread
  const hasContent = (data?.projects?.length ?? 0) > 0 || (data?.overlays?.length ?? 0) > 0;

  // AI : Check if we have valid bounds (location count > 1 or spread)
  // AI : calculateBoundsFromLocations returns null if 0 locations
  if (bounds && hasContent) {
    mobileAwareFlyToBounds(bounds, {
      animate: true,
      duration: 1.5,
      maxZoom: 15,
      padding: [50, 50],
    });
  } else {
    // AI : Fallback for empty cities: Default zoom to center
    if (map.value.getZoom() < 14) {
      mobileAwareFlyTo([city.lat, city.lng], 14, { duration: 1.5 });
    } else {
      mobileAwareFlyTo([city.lat, city.lng], map.value.getZoom(), { duration: 0.5 });
    }
  }
}

/**
 * AI : Activate a city (select, load data, and smart zoom)
 * AI : Extracted to be used by both marker clicks and HelpButton
 */
export async function activateCity(city: CityWithProjects) {
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

    // eslint-disable-next-line no-alert
    const confirmed = confirm(message);
    if (!confirmed) return;
  }

  // AI : Update selected city in store
  // AI : Note: We can't easily reset opacities here without access to the private layer
  // AI : But updateCityMarkerOpacities will be triggered by the watcher on mapStore.selectedCity
  mapStore.setSelectedCity({
    id: city.id,
    name: city.name,
    nameLocal: city.nameLocal,
    countryCode: city.countryCode,
  });

  // AI : Ensure we're using the correct satellite layer for this country
  await checkAndSwitchSatelliteLayer(city.countryCode);

  // AI : Request scroll to city in adjacent panels
  requestScrollTo("city", city.id);

  // AI : Load city data before flight animation
  const result = await loadAndRenderCityData(city.id, true);

  // AI : Smart zoom logic
  smartZoomToCity(city, result);
}

/**
 * AI : Create a layer group with city markers
 * AI : Handles all city-specific marker creation, event handling, and state management
 */
async function createCitiesMarkerLayer(cities: CityWithProjects[]) {
  const layer = L.layerGroup();
  const markers = new Map<string, L.Marker>();

  const defaultOpacity = MARKER_OPACITY.city.default;
  const hoverOpacity = MARKER_OPACITY.city.hover;

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
      await activateCity(city);
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
export async function addSingleCityMarker(
  city: {
    id: number;
    name: string;
    nameLocal: string | null;
    lat: number;
    lng: number;
    countryCode: string;
  },
  isUnsaved = false,
) {
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
  const result = await createCitiesMarkerLayer([cityData]);

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
        mergedCities = projectStore.getMergedCities(mergedCities, authStore.user?.id ?? null);
      }

      citiesData = mergedCities;
    }

    if (citiesData && citiesData.length > 0) {
      // AI : Store in global ref for viewport detection
      citiesWithProjects.value = citiesData;

      // AI : Add all city markers to map (without country filter)
      await addCityMarkersToMapInternal(citiesData);

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
export async function addCityMarkersForCountry(cities: CityWithProjects[], countryCode?: string) {
  if (!map.value) {
    console.error("Map not initialized when trying to add city markers for country");
    return;
  }
  await addCityMarkersToMapInternal(cities, countryCode);
}

/**
 * AI : Internal function to add city markers to map
 */
async function addCityMarkersToMapInternal(
  cities: CityWithProjects[],
  explicitCountryCode?: string,
) {
  const cityMarkersStore = useCityMarkersStore();

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

  // AI : Generate markers using existing logic (but not putting them in a group)
  // AI : createCitiesMarkerLayer returns a LayerGroup we can discard, and a Map of markers we keep
  const result = await createCitiesMarkerLayer(citiesToRender);
  // AI : Clear store first to remove stale cities (that might have been deleted/filtered out)
  // AI : CRITICAL: We need to remove them from the map if they were there!
  const currentMarkers = cityMarkersStore.getAllCityMarkers();
  for (const marker of currentMarkers.values()) {
    if (map.value && map.value.hasLayer(marker)) {
      marker.remove();
    }
  }
  cityMarkersStore.clearCityMarkerMap();

  for (const [cityId, marker] of result.markers) {
    cityMarkersStore.setCityMarker(cityId, marker);
  }

  // AI : Initialize watcher
  initializeCityMarkerWatcher();

  pruneMapEntities();

  // AI : Update opacities for selected city
  const mapStore = useMapStore();
  if (mapStore.selectedCity) {
    updateCityMarkerOpacities(mapStore.selectedCity.id);
  }
}

// AI : Accept HMR updates for this module
if (import.meta.hot) {
  import.meta.hot.accept();
}
