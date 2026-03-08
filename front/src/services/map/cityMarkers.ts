import L from "leaflet";
import { ref, watch } from "vue";
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
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useCityMarkersStore } from "@/stores/pinia/cityMarkersStore";
import { MARKER_OPACITY } from "@/constants/markerConstants";
import { createProjectCountIcon } from "@/services/map/markers";
import { runViewportRenderLoop } from "@/services/map/viewportRenderLoop";

import { requestScrollTo } from "@/services/layout/accordionState";

// Type aliases using RouterOutput from tRPC
export type CityWithProjects = RouterOutput["cities"]["getCitiesWithProjects"][number];

// Cities with projects data
export const citiesWithProjects = ref<CityWithProjects[]>([]);

/**
 * Build the list of cities to display for the current mode
 * View mode is always the base (approved content); edit/moderation modes add their own cities on top
 */
async function buildCitiesForCurrentMode(): Promise<CityWithProjects[]> {
  const mapStore = useMapStore();
  const authStore = useAuthStore();
  const projectStore = useProjectStore();

  // Unauthenticated users always see view mode regardless of store state
  const currentMode = authStore.isAuthenticated ? mapStore.mode : "view";

  if (currentMode === "view") {
    return projectStore.fetchCitiesWithProjects("view");
  }

  if (currentMode === "moderation") {
    // Moderation mode: only show cities that have pending items — no approved-only cities
    return projectStore.fetchCitiesWithProjects("moderation");
  }

  // Edit mode: additive — approved cities + user's own pending cities
  const viewCities = await projectStore.fetchCitiesWithProjects("view");
  const editCities = await projectStore.fetchCitiesWithProjects("edit");
  const viewCityIds = new Set(viewCities.map((c) => c.id));
  const additionalCities = editCities.filter((c) => !viewCityIds.has(c.id));
  const mergedCities = [...viewCities, ...additionalCities];
  return projectStore.getMergedCities(mergedCities, authStore.user?.id ?? null);
}

/**
 * Initialize mode change watcher (called lazily on first use)
 * This handles both switchMode() and direct setMode() calls (like from side menu)
 */
function initializeModeWatcher() {
  const cityMarkersStore = useCityMarkersStore();
  if (cityMarkersStore.modeWatcherInitialized) return;

  const mapStore = useMapStore();

  watch(
    () => mapStore.mode,
    async (newMode, oldMode) => {
      // Defensive guard — Vue shouldn't fire with equal values but the watcher is async
      if (newMode === oldMode) return;

      try {
        const cities = await buildCitiesForCurrentMode();
        citiesWithProjects.value = cities;
        // Always render all cities on mode change, never filter by country here
        await addCityMarkersToMapInternal(cities);
      } catch (error) {
        console.error("Error reloading city markers on mode change:", error);
      }
    },
  );

  cityMarkersStore.modeWatcherInitialized = true;
}

/**
 * Initialize selectedCity watcher to update city marker opacity
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
 * Update city marker opacities based on selected city
 */
function updateCityMarkerOpacities(selectedCityId: number | null): void {
  const cityMarkersStore = useCityMarkersStore();

  if (!cityMarkersStore.cityMarkersLayer) {
    return;
  }

  cityMarkersStore.cityMarkersLayer.eachLayer((layer) => {
    if (layer instanceof L.Marker) {
      const markerElement = layer.getElement();
      const cityId = markerElement?.dataset.cityId;

      if (selectedCityId && Number(cityId) === selectedCityId) {
        layer.setOpacity(MARKER_OPACITY.city.hover);
      } else {
        layer.setOpacity(MARKER_OPACITY.city.default);
      }
    }
  });
}

/**
 * Remove city markers from the map
 * NOTE: This does NOT remove standalone project markers - they are managed separately
 * Standalone project markers persist across city marker reloads and are only cleared when changing cities
 */
export function removeCityMarkers(): void {
  const cityMarkersStore = useCityMarkersStore();

  // Explicitly remove all markers from map
  for (const marker of cityMarkersStore.cityMarkerMap.values()) {
    if (map.value.hasLayer(marker)) {
      marker.remove();
    }
  }

  cityMarkersStore.cityMarkerMap.clear();
  // Don't clear unsaved city markers - they should persist across country switches
  // and will be filtered by country when displayed via addCityMarkersToMapInternal
}

/**
 * Smart zoom logic: Fit bounds of all content (center + projects + overlays)
 */
export function smartZoomToCity(
  city: { lat: number; lng: number },
  data: {
    overlays: { corners?: { lat: number; lng: number }[] | null }[];
    projects: { lat: number | null; lng: number | null }[];
  },
) {
  const { overlays, projects } = data;

  // Collect all content locations for bounds calculation
  // Projects have nullable lat/lng (standalone projects may lack coordinates)
  const locations: { lat: number; lng: number }[] = [
    { lat: city.lat, lng: city.lng },
    ...projects
      .filter((p): p is typeof p & { lat: number; lng: number } => p.lat !== null && p.lng !== null)
      .map((p) => ({ lat: p.lat, lng: p.lng })),
    ...overlays.flatMap((o) => (Array.isArray(o.corners) ? o.corners : [])),
  ];

  const hasContent = projects.length > 0 || overlays.length > 0;

  if (hasContent) {
    // Fit to bounds of all content
    const bounds = calculateBoundsFromLocations(locations);
    mobileAwareFlyToBounds(bounds!, {
      animate: true,
      duration: 1.5,
      maxZoom: 15,
      padding: [50, 50],
    });
  } else if (map.value.getZoom() < 14) {
    // Empty city below threshold: zoom in to a readable level
    mobileAwareFlyTo([city.lat, city.lng], 14, { duration: 1.5 });
  } else {
    // Empty city already zoomed in: pan only
    mobileAwareFlyTo([city.lat, city.lng], map.value.getZoom(), { duration: 0.5 });
  }
}

/**
 * Activate a city (select, load data, and smart zoom)
 * Extracted to be used by both marker clicks and HelpButton
 */
export async function activateCity(city: CityWithProjects) {
  const mapStore = useMapStore();

  // Update selected city in store
  // Note: We can't easily reset opacities here without access to the private layer
  // But updateCityMarkerOpacities will be triggered by the watcher on mapStore.selectedCity
  mapStore.setSelectedCity({
    id: city.id,
    name: city.name,
    nameLocal: city.nameLocal,
    countryCode: city.countryCode,
  });

  // Request scroll to city in adjacent panels
  requestScrollTo("city", city.id);

  // Load city data before flight animation
  // Leaflet event handlers have no composable layer above them, so errors must be caught here
  try {
    const result = await loadAndRenderCityData(city.id, true);
    smartZoomToCity(city, result);
  } catch (error) {
    console.error(`Failed to load data for city ${city.id}:`, error);
    // Still zoom to city center so the map stays usable even if data loading failed
    smartZoomToCity(city, { overlays: [], projects: [] });
  }
}

/**
 * Create a layer group with city markers
 * Handles all city-specific marker creation, event handling, and state management
 */
async function createCitiesMarkerLayer(cities: CityWithProjects[]) {
  const layer = L.layerGroup();
  const markers = new Map<string, L.Marker>();

  const defaultOpacity = MARKER_OPACITY.city.default;
  const hoverOpacity = MARKER_OPACITY.city.hover;

  for (const city of cities) {
    // Create marker with blue icon
    const marker = L.marker([city.lat, city.lng], {
      icon: createProjectCountIcon(city.projectCount),
      opacity: defaultOpacity,
    });

    // Bind tooltip
    const tooltipText = city.nameLocal ? `${city.name} (${city.nameLocal})` : city.name;
    marker.bindTooltip(tooltipText, { permanent: false });

    // Set up data attributes after marker is added to DOM
    marker.on("add", () => {
      const markerElement = marker.getElement();
      if (markerElement) {
        markerElement.dataset.testid = `city-marker-${city.id}`;
        markerElement.dataset.cityId = String(city.id);
        markerElement.dataset.cityName = city.name;
        markerElement.dataset.cityNameLocal = city.nameLocal ?? "";
        markerElement.dataset.countryCode = city.countryCode;
        markerElement.dataset.lat = city.lat.toString();
        markerElement.dataset.lng = city.lng.toString();
      }
    });

    // Prevent double-click zoom on markers
    marker.on("dblclick", (e) => {
      L.DomEvent.stopPropagation(e);
    });

    // Hover event - increase opacity (respects selected state)
    marker.on("mouseover", () => {
      marker.setOpacity(hoverOpacity);
    });

    // Mouse out event - reset to default, let watcher handle selected state
    marker.on("mouseout", () => {
      const mapStore = useMapStore();
      const isSelected = mapStore.selectedCity?.id === city.id;

      // Only reset if this is NOT the currently selected city
      // The watcher will keep selected city at hover opacity
      if (!isSelected) {
        marker.setOpacity(defaultOpacity);
      }
    });

    // Click event - load city data
    marker.on("click", async (e) => {
      L.DomEvent.stopPropagation(e);
      await activateCity(city);
    });

    // Store marker and add to layer
    markers.set(String(city.id), marker);
    marker.addTo(layer);
  }

  return { layer, markers };
}

/**
 * Add a single city marker without replacing existing ones
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

  // Don't add if marker already exists
  if (cityMarkersStore.cityMarkerMap.get(String(city.id))) return;

  // Initialize layer if needed
  if (!cityMarkersStore.cityMarkersLayer) {
    cityMarkersStore.cityMarkersLayer = L.layerGroup().addTo(map.value);
    initializeCityMarkerWatcher();
  }

  // Create marker using createCitiesMarkerLayer
  const cityData: CityWithProjects = { ...city, projectCount: 0 };
  const result = await createCitiesMarkerLayer([cityData]);

  // Add marker to existing layer
  for (const [cityId, marker] of result.markers) {
    cityMarkersStore.cityMarkersLayer.addLayer(marker);
    cityMarkersStore.cityMarkerMap.set(cityId, marker);
  }

  // Track if this is an unsaved city marker
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
 * Entry point for the city marker system: fetches cities for the current mode,
 * renders them on the map, and arms the mode watcher for subsequent mode changes.
 */
export async function loadAllCityMarkersGlobally(): Promise<CityWithProjects[]> {
  const citiesData = await buildCitiesForCurrentMode();

  citiesWithProjects.value = citiesData;
  await addCityMarkersToMapInternal(citiesData);
  // Initialize mode watcher after initial load so cities re-fetch when mode changes
  initializeModeWatcher();

  return citiesData;
}

/**
 * Add city markers for a specific country
 */
export async function addCityMarkersForCountry(cities: CityWithProjects[], countryCode?: string) {
  await addCityMarkersToMapInternal(cities, countryCode);
}

/**
 * Internal function to add city markers to map
 */
async function addCityMarkersToMapInternal(
  cities: CityWithProjects[],
  explicitCountryCode?: string,
) {
  const cityMarkersStore = useCityMarkersStore();
  const mapStore = useMapStore();
  const authStore = useAuthStore();

  // Determine country code from explicit parameter or derive from cities
  const countryCode = explicitCountryCode ?? cities[0]?.countryCode;

  // Merge backend cities with unsaved city markers for THIS country only
  const unsavedCities: CityWithProjects[] = [...cityMarkersStore.unsavedCityMarkers.entries()]
    .filter(([cityId, cityData]) => {
      // Only include unsaved markers for the current country
      if (countryCode && cityData.countryCode !== countryCode) return false;
      // Don't include if city already exists in backend data
      return !cities.some((c) => c.id === cityId);
    })
    .map(([cityId, cityData]) => Object.assign({ id: cityId, projectCount: 0 }, cityData));

  const allCities = [...cities, ...unsavedCities];

  // Filter cities for moderation mode if user is restricted

  let citiesToRender = allCities;

  if (
    mapStore.mode === "moderation" &&
    authStore.user &&
    authStore.user.role !== "admin" &&
    authStore.user.moderatedCountries
  ) {
    const moderatedCountries = authStore.user.moderatedCountries;
    citiesToRender = citiesToRender.filter((city) => moderatedCountries.includes(city.countryCode));
  }

  // Generate markers using existing logic
  // createCitiesMarkerLayer returns a LayerGroup and a Map of markers
  const result = await createCitiesMarkerLayer(citiesToRender);

  // Clear store first to remove stale cities (that might have been deleted/filtered out)
  // CRITICAL: We need to remove the old layer from the map if it exists!
  if (cityMarkersStore.cityMarkersLayer && map.value.hasLayer(cityMarkersStore.cityMarkersLayer)) {
    cityMarkersStore.cityMarkersLayer.remove();
  }

  // Clear the marker map
  cityMarkersStore.cityMarkerMap.clear();

  // Store the new layer in the store (CRITICAL - this was missing!)
  cityMarkersStore.cityMarkersLayer = result.layer;

  result.layer.addTo(map.value);

  // Store individual marker references for easy access
  for (const [cityId, marker] of result.markers) {
    cityMarkersStore.cityMarkerMap.set(cityId, marker);
  }

  initializeCityMarkerWatcher();

  runViewportRenderLoop();

  // Update opacities for selected city
  if (mapStore.selectedCity) {
    updateCityMarkerOpacities(mapStore.selectedCity.id);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
