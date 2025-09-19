import L from "leaflet";
import { createColorIcon } from '@composables/ui/markerIcons';
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { loadCityOverlays } from '@composables/map/useCityOverlays';
import { useMapStore } from '@stores/pinia/mapStore';
import { useSelectedProject } from '@composables/project/useSelectedProject';
import { storeToRefs } from 'pinia';
import { RouterOutput } from '@client';

// AI : Function to get store refs when needed
function getStoreRefs() {
  const mapStore = useMapStore();
  const { selectedCity } = storeToRefs(mapStore);
  const { selectedProjectId } = useSelectedProject();
  return { selectedProjectId, selectedCity, mapStore };
}

// AI : Function to get selected project ID when needed (kept for backward compatibility)
function getSelectedProjectId() {
  const { selectedProjectId } = useSelectedProject();
  return selectedProjectId;
}

// AI : Opacity constants for city markers
const CITY_MARKER_OPACITY = 0.6; // AI : Default opacity for city markers
const CITY_MARKER_HOVER_OPACITY = 1; // AI : Opacity for city markers on hover

// AI : Type aliases using RouterOutput from tRPC
export type CityWithProjects = RouterOutput['cities']['getCitiesWithProjects'][number];

// AI : Cities with projects data
export const citiesWithProjects = ref<CityWithProjects[]>([]);

// AI : Layer group for city markers
let cityMarkersLayer: L.LayerGroup | null = null;

// AI : Track the currently selected (clicked) city marker
let selectedCityMarker: L.Marker | null = null;

/**
 * AI : Load projects for a specific city and display overlays on map
 */
export async function loadCityProjects(cityId: string, cityName: string, forceFullLoad = false, cityCountryCode?: string): Promise<void> {
  try {
    // AI : Update selected city in store
    const { mapStore } = getStoreRefs();
    mapStore.setSelectedCity({ id: cityId, name: cityName, countryCode: cityCountryCode });

    // AI : Clear selected project when switching cities
    const selectedProjectId = getSelectedProjectId();
    selectedProjectId.value = null;

    // AI : Delegate overlay loading to the dedicated overlay module
    await loadCityOverlays(cityId, cityName, forceFullLoad);
  } catch (error) {
    console.error('AI : Error loading city projects:', error);
  }
}

/**
 * AI : Remove city markers from the map
 */
export function removeCityMarkers(): void {
  if (cityMarkersLayer && map.value?.hasLayer(cityMarkersLayer)) {
    map.value.removeLayer(cityMarkersLayer);
    cityMarkersLayer = null;
  }
}

/**
 * AI : Add city markers for a specific country
 */
export function addCityMarkersForCountry(cities: CityWithProjects[]): void {
  if (!map.value) {
    onMapInitialized(() => {
      addCityMarkersToMapInternal(cities);
    });
    return;
  }
  addCityMarkersToMapInternal(cities);
}

/**
 * AI : Internal function to add city markers to map
 */
function addCityMarkersToMapInternal(cities: CityWithProjects[]): void {
  if (!map.value) {
    return;
  }

  // AI : Always remove and re-initialize cityMarkersLayer to prevent stacking
  if (cityMarkersLayer) {
    map.value.removeLayer(cityMarkersLayer);
  }
  cityMarkersLayer = L.layerGroup();

  cities.forEach(city => {
    // AI : Create SVG marker for cities (using blue color)
    const markerIcon = createColorIcon('blue');
    const marker = L.marker([city.lat, city.lng], {
      icon: markerIcon,
      opacity: CITY_MARKER_OPACITY // AI : Lower default opacity to suggest interactivity
    });

    // AI : Add data-testid to the marker element after it's added to the DOM
    marker.on('add', () => {
      const markerElement = marker.getElement();
      if (markerElement) {
        markerElement.setAttribute('data-testid', `city-marker-${city.id}`);
        markerElement.setAttribute('data-city-id', city.id);
        markerElement.setAttribute('data-city-name', city.name);
        markerElement.setAttribute('data-country-code', city.countryCode);
      }
    });

    // AI : Add tooltip with city name, only on hover
    marker.bindTooltip(city.name, {
      permanent: false, // AI : Tooltip appears only on hover
    });

    // AI : Add click event to load city projects directly and set marker as selected
    marker.on('click', () => {
      // AI : Set all city markers to default opacity except the clicked one
      if (cityMarkersLayer) {
        cityMarkersLayer.eachLayer((layer) => {
          if (layer instanceof L.Marker) {
            layer.setOpacity(CITY_MARKER_OPACITY);
          }
        });
      }
      marker.setOpacity(CITY_MARKER_HOVER_OPACITY);
      selectedCityMarker = marker;
      void loadCityProjects(city.id, city.name, false, city.countryCode);
    });

    // AI : Add mouseover event to show guidance tooltip and increase marker opacity
    marker.on('mouseover', () => {
      // AI : Only increase opacity if not selected
      if (selectedCityMarker !== marker) {
        marker.setOpacity(CITY_MARKER_HOVER_OPACITY);
      }
    });

    // AI : Add mouseout event to hide guidance tooltip and reset marker opacity if not selected
    marker.on('mouseout', () => {
      // AI : Only reset opacity if not selected
      if (selectedCityMarker !== marker) {
        marker.setOpacity(CITY_MARKER_OPACITY);
      }
    });

    cityMarkersLayer!.addLayer(marker);
  });

  // AI : Add the layer group to the map if it exists
  if (cityMarkersLayer) {
    cityMarkersLayer.addTo(map.value);
  }

  // AI : Reset selected marker when new markers are added
  selectedCityMarker = null;
}