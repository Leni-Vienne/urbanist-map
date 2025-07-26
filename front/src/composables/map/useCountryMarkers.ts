import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { addCityMarkersForCountry } from '@composables/map/useCityMarkers';
import { trpc } from '@client';
import { useProjectStore } from '@stores/pinia/projectStore';
import { storeToRefs } from 'pinia';

// AI : Function to get countries when needed
function getCountries() {
  const projectStore = useProjectStore();
  const { countries } = storeToRefs(projectStore);
  return countries;
}

export const isLoadingCountries = ref(false);
export const isLoadingCountryProjects = ref(false);

let countryMarkersLayer: L.LayerGroup | null = null;

export async function loadCountriesWithProjects(): Promise<void> {
  try {
    isLoadingCountries.value = true;
    const countriesData = await trpc.country.getCountriesWithProjects.query();
    const countries = getCountries();
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
    const countries = getCountries();
    const country = countries.value.find((c: any) => c.code === countryCode);
    if (country) {
      country.cities = citiesData.map((c: any) => ({ ...c, distance: 0 }));
    }
  } catch (error) {
    console.error(`Error loading cities for country ${countryCode}:`, error);
  } finally {
    isLoadingCountryProjects.value = false;
  }
}


export async function addCountryMarkersToMap(): Promise<void> {
  if (!map.value) {
    onMapInitialized(() => {
      addCountryMarkersToMapInternal();
    });
    return;
  }
  await addCountryMarkersToMapInternal();
}

async function addCountryMarkersToMapInternal(): Promise<void> {
  if (!map.value) {
    return;
  }

  if (countryMarkersLayer) {
    map.value.removeLayer(countryMarkersLayer);
  }

  countryMarkersLayer = L.layerGroup();
  const countries = getCountries();
  countries.value.forEach((country: any) => {
    const marker = L.marker([country.lat, country.lng]);
    marker.bindTooltip(`${country.name}`, {
      permanent: true,
    });
    marker.on('click', async () => {
      await loadCitiesForCountry(country.code);
      const updatedCountries = getCountries();
      const updatedCountry = updatedCountries.value.find((c: any) => c.code === country.code);
      if (updatedCountry) {
        addCityMarkersForCountry(updatedCountry.cities.map((c: any) => ({ ...c, projectCount: 0 })));
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
