import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { countries } from '@stores/projectStore';
import { addCityMarkersForCountry, CityWithProjects } from '@composables/map/useCityMarkers';
import { trpc, RouterOutput } from '@client';

export const isLoadingCountries = ref(false);
export const isLoadingCountryProjects = ref(false);

let countryMarkersLayer: L.LayerGroup | null = null;

export async function loadCountriesWithProjects(): Promise<void> {
  try {
    isLoadingCountries.value = true;
    const countriesData = await trpc.country.getCountriesWithProjects.query();
    countries.value = countriesData.map((country) => ({
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
    const country = countries.value.find(c => c.code === countryCode);
    if (country) {
      country.cities = citiesData.map(c => ({ ...c, distance: 0 }));
    }
  } catch (error) {
    console.error(`Error loading cities for country ${countryCode}:`, error);
  } finally {
    isLoadingCountryProjects.value = false;
  }
}


export function addCountryMarkersToMap(): void {
  if (!map.value) {
    onMapInitialized(() => {
      addCountryMarkersToMapInternal();
    });
    return;
  }
  addCountryMarkersToMapInternal();
}

function addCountryMarkersToMapInternal(): void {
  if (!map.value) {
    return;
  }

  if (countryMarkersLayer) {
    map.value.removeLayer(countryMarkersLayer);
  }

  countryMarkersLayer = L.layerGroup();
  countries.value.forEach(country => {
    const marker = L.marker([country.lat, country.lng]);
    marker.bindTooltip(`${country.name}`, {
      permanent: true,
    });
    marker.on('click', async () => {
      await loadCitiesForCountry(country.code);
      const updatedCountry = countries.value.find((c) => c.code === country.code);
      if (updatedCountry) {
        addCityMarkersForCountry(updatedCountry.cities.map(c => ({ ...c, projectCount: 0 })));
      }
    });
    countryMarkersLayer!.addLayer(marker);
  });

  countryMarkersLayer.addTo(map.value);
}

export function removeCountryMarkers(): void {
  if (map.value && countryMarkersLayer) {
    map.value.removeLayer(countryMarkersLayer);
    countryMarkersLayer = null;
  }
}

export async function initializeCountryMarkers(): Promise<void> {
  await loadCountriesWithProjects();
  addCountryMarkersToMap();
}

export function cleanupCountryMarkers(): void {
  removeCountryMarkers();
}
