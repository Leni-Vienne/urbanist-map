import L from "leaflet";
import { ref, watch } from "vue";
import { t } from "@/locales";
import { map } from "@/services/core/map";
import {
  mobileAwareFlyTo,
  mobileAwareFlyToBounds,
  calculateBoundsFromLocations,
} from "@/services/map/mapNavigation";
import { loadAndRenderCityData } from "@/services/navigation/cityNavigationTriggers";
import type { RouterOutput } from "@/client";

import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { MARKER_OPACITY } from "@/constants/markerConstants";
import { createColorIcon } from "@/services/map/markers";
import { runViewportRenderLoop } from "@/services/map/viewportRenderLoop";

import { requestScrollTo } from "@/services/layout/accordionState";

// AI : Type aliases using RouterOutput from tRPC
export type CityWithProjects = RouterOutput["cities"]["getCitiesWithProjects"][number];

// AI : Cities with projects data
export const citiesWithProjects = ref<CityWithProjects[]>([]);

/**
 * AI : Build the list of cities to display for the current mode
 * AI : View mode is always the base (approved content); edit/moderation modes add their own cities on top
 */
async function buildCitiesForCurrentMode(): Promise<CityWithProjects[]> {
  const overlayStore = useOverlayStore();
  const authStore = useAuthStore();
  const projectStore = useProjectStore();

  // AI : View cities are always fetched first — they are the base set (approved content, visible to everyone)
  const viewCities = await projectStore.fetchCitiesWithProjects("view");
  // AI : Unauthenticated users always see view mode regardless of store state
  const currentMode = authStore.isAuthenticated ? overlayStore.mode : "view";

  if (currentMode === "view") {
    return viewCities;
  }

  // AI : Edit/moderation modes are additive: start from approved cities, then union in mode-specific ones
  const modeCities = await projectStore.fetchCitiesWithProjects(currentMode);
  const viewCityIds = new Set(viewCities.map((c) => c.id));
  const additionalCities = modeCities.filter((c) => !viewCityIds.has(c.id));
  let mergedCities = [...viewCities, ...additionalCities];

  // AI : In edit mode, also surface cities from locally created projects not yet submitted to the backend
  if (currentMode === "edit") {
    mergedCities = projectStore.getMergedCities(mergedCities, authStore.user?.id ?? null);
  }

  return mergedCities;
}

/**
 * AI : Initialize mode change watcher (called lazily on first use)
 * This handles both switchMode() and direct setMode() calls (like from side menu)
 */
function initializeModeWatcher() {
  const cityMarkersStore = useCityMarkersStore();
  if (cityMarkersStore.modeWatcherInitialized) return;

  const overlayStore = useOverlayStore();

  watch(
    () => overlayStore.mode,
    async (newMode, oldMode) => {
      // AI : Defensive guard — Vue shouldn't fire with equal values but the watcher is async
      if (newMode === oldMode) return;

      try {
        const cities = await buildCitiesForCurrentMode();
        citiesWithProjects.value = cities;
        // AI : Always render all cities on mode change, never filter by country here
        await addCityMarkersToMapInternal(cities);
      } catch (error) {
        console.error("Error reloading city markers on mode change:", error);
      }
    },
  );

  cityMarkersStore.modeWatcherInitialized = true;
}

/**
 * AI : Initialize selectedCity watcher to update city marker opacity
 * This makes the selected city marker opaque when navigating from panels
 */
function initializeCityMarkerWatcher() {
  const cityMarkersStore = useCityMarkersStore();
  if (cityMarkersStore.cityMarkerWatcherInitialized) return;

  const mapStore = useMapStore();
  watch(
    () => mapStore.selectedCity,
    (selectedCity) => {
      updateCityMarkerOpacities(selectedCity?.id ?? null);
    },
  );

  cityMarkersStore.cityMarkerWatcherInitialized = true;
}

/**
 * AI : Update city marker opacities based on selected city
 */
function updateCityMarkerOpacities(selectedCityId: number | null): void {
  const cityMarkersStore = useCityMarkersStore();

  if (!cityMarkersStore.cityMarkersLayer) {
    return;
  }

  cityMarkersStore.cityMarkersLayer.eachLayer((layer) => {
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
  for (const marker of cityMarkersStore.cityMarkerMap.values()) {
    if (map.value.hasLayer(marker)) {
      marker.remove();
    }
  }

  cityMarkersStore.cityMarkerMap.clear();
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
  const { overlays, projects } = data;

  // AI : Collect all content locations for bounds calculation
  // AI : Projects have nullable lat/lng (standalone projects may lack coordinates)
  const locations: { lat: number; lng: number }[] = [
    { lat: city.lat, lng: city.lng },
    ...projects
      .filter((p): p is typeof p & { lat: number; lng: number } => p.lat !== null && p.lng !== null)
      .map((p) => ({ lat: p.lat, lng: p.lng })),
    ...overlays.flatMap((o) => (Array.isArray(o.corners) ? o.corners : [])),
  ];

  const hasContent = projects.length > 0 || overlays.length > 0;

  if (hasContent) {
    // AI : Fit to bounds of all content
    const bounds = calculateBoundsFromLocations(locations);
    mobileAwareFlyToBounds(bounds!, {
      animate: true,
      duration: 1.5,
      maxZoom: 15,
      padding: [50, 50],
    });
  } else if (map.value.getZoom() < 14) {
    // AI : Empty city below threshold: zoom in to a readable level
    mobileAwareFlyTo([city.lat, city.lng], 14, { duration: 1.5 });
  } else {
    // AI : Empty city already zoomed in: pan only
    mobileAwareFlyTo([city.lat, city.lng], map.value.getZoom(), { duration: 0.5 });
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

  // AI : Request scroll to city in adjacent panels
  requestScrollTo("city", city.id);

  // AI : Load city data before flight animation
  // AI : Leaflet event handlers have no composable layer above them, so errors must be caught here
  try {
    const result = await loadAndRenderCityData(city.id, true);
    smartZoomToCity(city, result);
  } catch (error) {
    console.error(`Failed to load data for city ${city.id}:`, error);
    // AI : Still zoom to city center so the map stays usable even if data loading failed
    smartZoomToCity(city, { overlays: [], projects: [] });
  }
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

    // AI : Mouse out event - reset to default, let watcher handle selected state
    marker.on("mouseout", () => {
      const mapStore = useMapStore();
      const isSelected = mapStore.selectedCity?.id === city.id;

      // AI : Only reset if this is NOT the currently selected city
      // AI : The watcher will keep selected city at hover opacity
      if (!isSelected) {
        marker.setOpacity(defaultOpacity);
      }
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
  const cityMarkersStore = useCityMarkersStore();

  // AI : Don't add if marker already exists
  if (cityMarkersStore.cityMarkerMap.get(String(city.id))) return;

  // AI : Initialize layer if needed
  if (!cityMarkersStore.cityMarkersLayer) {
    cityMarkersStore.cityMarkersLayer = L.layerGroup().addTo(map.value);
    initializeCityMarkerWatcher();
  }

  // AI : Create marker using createCitiesMarkerLayer
  const cityData: CityWithProjects = { ...city, projectCount: 0 };
  const result = await createCitiesMarkerLayer([cityData]);

  // AI : Add marker to existing layer
  for (const [cityId, marker] of result.markers) {
    cityMarkersStore.cityMarkersLayer.addLayer(marker);
    cityMarkersStore.cityMarkerMap.set(cityId, marker);
  }

  // AI : Track if this is an unsaved city marker
  if (isUnsaved) {
    cityMarkersStore.unsavedCityMarkers.set(city.id, {
      name: city.name,
      nameLocal: city.nameLocal,
      lat: city.lat,
      lng: city.lng,
      countryCode: city.countryCode,
    });
  }
}

/**
 * AI : Entry point for the city marker system: fetches cities for the current mode,
 * AI : renders them on the map, and arms the mode watcher for subsequent mode changes.
 */
export async function loadAllCityMarkersGlobally(): Promise<CityWithProjects[]> {
  const citiesData = await buildCitiesForCurrentMode();

  citiesWithProjects.value = citiesData;
  await addCityMarkersToMapInternal(citiesData);
  // AI : Initialize mode watcher after initial load so cities re-fetch when mode changes
  initializeModeWatcher();

  return citiesData;
}

/**
 * AI : Add city markers for a specific country
 */
export async function addCityMarkersForCountry(cities: CityWithProjects[], countryCode?: string) {
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
  const countryCode = explicitCountryCode ?? cities[0]?.countryCode;

  // AI : Merge backend cities with unsaved city markers for THIS country only
  const unsavedCities: CityWithProjects[] = [...cityMarkersStore.unsavedCityMarkers.entries()]
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

  // AI : Generate markers using existing logic
  // AI : createCitiesMarkerLayer returns a LayerGroup and a Map of markers
  const result = await createCitiesMarkerLayer(citiesToRender);

  // AI : Clear store first to remove stale cities (that might have been deleted/filtered out)
  // AI : CRITICAL: We need to remove the old layer from the map if it exists!
  if (cityMarkersStore.cityMarkersLayer && map.value.hasLayer(cityMarkersStore.cityMarkersLayer)) {
    cityMarkersStore.cityMarkersLayer.remove();
  }

  // AI : Clear the marker map
  cityMarkersStore.cityMarkerMap.clear();

  // AI : Store the new layer in the store (CRITICAL - this was missing!)
  cityMarkersStore.cityMarkersLayer = result.layer;

  // AI : Add the layer to the map
  result.layer.addTo(map.value);

  // AI : Store individual marker references for easy access
  for (const [cityId, marker] of result.markers) {
    cityMarkersStore.cityMarkerMap.set(cityId, marker);
  }

  // AI : Initialize watcher
  initializeCityMarkerWatcher();

  runViewportRenderLoop();

  // AI : Update opacities for selected city
  const mapStore = useMapStore();
  if (mapStore.selectedCity) {
    updateCityMarkerOpacities(mapStore.selectedCity.id);
  }
}

// AI : Accept HMR updates for this module
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
