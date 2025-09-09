import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { addCityMarkersForCountry, removeCityMarkers, currentCityOverlays, removeOverlayMarkers } from '@composables/map/useCityMarkers';
import { clearAllOverlays } from '@composables/overlay/useOverlay';
import { switchTileLayer, isTileLayerType } from '@composables/map/useTileLayers';
import { trpc } from '@client';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { storeToRefs } from 'pinia';
import { createColorIcon } from '@composables/ui/markerIcons';
import type { Country } from '@types';

// AI : Function to get countries when needed
function getCountries() {
  const projectStore = useProjectStore();
  const { countries } = storeToRefs(projectStore);
  return countries;
}


// AI : Opacity constants for country markers
const COUNTRY_MARKER_OPACITY = 0.6; // AI : Default opacity for country markers
const COUNTRY_MARKER_HOVER_OPACITY = 1; // AI : Opacity for country markers on hover

const isLoadingCountries = ref(false);
const isLoadingCountryProjects = ref(false);

let countryMarkersLayer: L.LayerGroup | null = null;

// AI : Mouse tooltip element for guidance
let countryMouseTooltip: HTMLElement | null = null;

// AI : Track the currently selected (clicked) country marker
let selectedCountryMarker: L.Marker | null = null;

export async function loadCountriesWithProjects(): Promise<void> {
  try {
    isLoadingCountries.value = true;
    const countriesData = await trpc.country.getCountriesWithProjects.query();
    const countries = getCountries();
    countries.value = countriesData.map((country): Country => ({
      ...country,
      lat: country.centerCoordinates.y,
      lng: country.centerCoordinates.x,
      projectCount: 0, // AI : This will be updated later
      cities: [], // AI : Empty array, cities will be loaded when user clicks on country
      createdAt: new Date(), // AI : Add fallback
      updatedAt: new Date(), // AI : Add fallback
    }));
  } catch (error) {
    console.error('Error loading countries with projects:', error);
  } finally {
    isLoadingCountries.value = false;
  }
}

export async function loadCitiesForCountry(countryCode: string): Promise<void> {
  try {
    isLoadingCountryProjects.value = true;
    const citiesData = await trpc.cities.getCitiesWithProjects.query({ countryCode });
    const countries = getCountries();
    const country = countries.value.find((c: Country) => c.code === countryCode);
    if (country) {
      country.cities = citiesData.map((c) => ({ ...c, distance: 0 }));
    }
  } catch (error) {
    console.error(`Error loading cities for country ${countryCode}:`, error);
  } finally {
    isLoadingCountryProjects.value = false;
  }
}


export function addCountryMarkersToMap() {
  if (!map.value) {
    onMapInitialized(() => {
      addCountryMarkersToMapInternal();
    });
    return;
  }
  addCountryMarkersToMapInternal();
  addCountryMarkersToMapInternal();
}

function addCountryMarkersToMapInternal() {
  if (!map.value) {
    return;
  }

  if (countryMarkersLayer) {
    map.value.removeLayer(countryMarkersLayer);
  }

  countryMarkersLayer = L.layerGroup();
  const countries = getCountries();
  countries.value.forEach((country) => {
    // AI : Create SVG marker for countries (using blue color)
    const markerIcon = createColorIcon('blue');
    const marker = L.marker([country.lat, country.lng], {
      icon: markerIcon,
      opacity: COUNTRY_MARKER_OPACITY, // AI : Lower default opacity to suggest interactivity
    });

    // AI : Add data-testid to the marker element after it's added to the DOM
    marker.on('add', () => {
      const markerElement = marker.getElement();
      if (markerElement) {
        markerElement.setAttribute('data-testid', `country-marker-${country.code}`);
        markerElement.setAttribute('data-country-code', country.code);
        markerElement.setAttribute('data-country-name', country.name);
      }
    });

    // AI : Add tooltip with country name, only on hover
    marker.bindTooltip(country.name, {
      permanent: false, // AI : Tooltip appears only on hover
    });

    // AI : Add click event to load cities and set marker as selected
    marker.on('click', () => {
      // AI : Set all country markers to default opacity except the clicked one
      if (countryMarkersLayer) {
        countryMarkersLayer.eachLayer((layer) => {
          if (layer instanceof L.Marker) {
            layer.setOpacity(COUNTRY_MARKER_OPACITY);
          }
        });
      }
      marker.setOpacity(COUNTRY_MARKER_HOVER_OPACITY);
      selectedCountryMarker = marker;


      // AI : Automatically switch to the appropriate tile layer for this country
      switchTileLayer(isTileLayerType(country.code) ? country.code : 'esri');

      // AI : Clear previous city markers, overlays and selected city state before loading new ones
      removeCityMarkers();
      removeOverlayMarkers();
      clearAllOverlays();
      currentCityOverlays.value = [];
      const mapStore = useMapStore();
      mapStore.clearSelectedCity();

      void loadCitiesForCountry(country.code).then(() => {
        const updatedCountries = getCountries();
        const updatedCountry = updatedCountries.value.find((c: Country) => c.code === country.code);
        if (updatedCountry) {
          addCityMarkersForCountry(updatedCountry.cities.map((c) => ({ ...c, projectCount: 0 })));
        }
      });
    });

    // AI : Add mouseover event to show guidance tooltip and increase marker opacity
    marker.on('mouseover', (event) => {
      createCountryMouseTooltip();
      showCountryMouseTooltip(event.originalEvent);
      // AI : Only increase opacity if not selected
      if (selectedCountryMarker !== marker) {
        marker.setOpacity(COUNTRY_MARKER_HOVER_OPACITY);
      }
    });

    // AI : Add mousemove event to update tooltip position
    marker.on('mousemove', (event) => {
      updateCountryMouseTooltipPosition(event.originalEvent);
    });

    // AI : Add mouseout event to hide guidance tooltip and reset marker opacity if not selected
    marker.on('mouseout', () => {
      hideCountryMouseTooltip();
      // AI : Only reset opacity if not selected
      if (selectedCountryMarker !== marker) {
        marker.setOpacity(COUNTRY_MARKER_OPACITY);
      }
    });

    countryMarkersLayer!.addLayer(marker);
  });

  countryMarkersLayer.addTo(map.value);

  // AI : Reset selected marker when new markers are added
  selectedCountryMarker = null;
}

/**
 * AI : Create and initialize country mouse tooltip element
 */
function createCountryMouseTooltip(): void {
  if (countryMouseTooltip) return;

  countryMouseTooltip = document.createElement('div');
  countryMouseTooltip.style.cssText = `
    position: fixed;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
    z-index: 10000;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
    white-space: nowrap;
  `;
  countryMouseTooltip.textContent = 'Click on a country marker to view its cities';
  document.body.appendChild(countryMouseTooltip);
}

/**
 * AI : Show country mouse tooltip at cursor position
 */
function showCountryMouseTooltip(event: MouseEvent): void {
  if (!countryMouseTooltip) return;

  countryMouseTooltip.style.left = event.clientX + 15 + 'px';
  countryMouseTooltip.style.top = event.clientY - 10 + 'px';
  countryMouseTooltip.style.opacity = '1';
}

/**
 * AI : Hide country mouse tooltip
 */
function hideCountryMouseTooltip(): void {
  if (!countryMouseTooltip) return;
  countryMouseTooltip.style.opacity = '0';
}

/**
 * AI : Update country mouse tooltip position on mouse move
 */
function updateCountryMouseTooltipPosition(event: MouseEvent): void {
  if (!countryMouseTooltip || countryMouseTooltip.style.opacity === '0') return;

  countryMouseTooltip.style.left = event.clientX + 15 + 'px';
  countryMouseTooltip.style.top = event.clientY - 10 + 'px';
}

export async function initializeCountryMarkers(): Promise<void> {
  await loadCountriesWithProjects();
  addCountryMarkersToMap();
}
