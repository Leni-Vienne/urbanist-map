// AI : Refactored to contain city navigation logic locally
import { loadCitiesForCountry, clearAllMapContent } from "@/services/map/countryData";
import { checkAndSwitchSatelliteLayer } from "@/services/map/tileLayers";
import { getSelectedProjectId } from "@/services/project/projectSelection";
import { map } from "@/services/core/map";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { t } from "@/locales";

/**
 * AI : Navigate to a city on the map
 * AI : This simulates clicking on a country marker then a city marker
 * @param cityId - The city ID to navigate to
 * @param cityName - The city name (for display)
 * @param countryCode - The country code where the city is located
 * @param cityCoords - Optional city coordinates (used when city not yet loaded in store)
 * @returns Promise that resolves when navigation is complete
 */
/**
 * AI : Load projects for a specific city and display overlays on map
 * AI : Moved here from cityMarkers.ts to separate navigation from marker rendering
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

    // AI : Ensure we're using the correct satellite layer for this country
    await checkAndSwitchSatelliteLayer(cityCountryCode);

    // AI : Only clear state when actually switching cities, not when refreshing
    if (isSwitchingCity) {
      // AI : Clear selected project when switching cities
      const selectedProjectId = getSelectedProjectId();
      selectedProjectId.value = null;

      // AI : Close project info popup when switching cities
      uiStore.closeProjectInfoPopup();
    }
  } catch (error) {
    console.error("Error loading city projects:", error);
  }
}

/**
 * AI : Navigate to a city on the map
 * AI : This simulates clicking on a country marker then a city marker
 * @param cityId - The city ID to navigate to
 * @param cityName - The city name (for display)
 * @param countryCode - The country code where the city is located
 * @param cityCoords - Optional city coordinates (used when city not yet loaded in store)
 * @returns Promise that resolves when navigation is complete
 */
export async function navigateToCity(
  cityId: number,
  cityName: string,
  countryCode: string,
  cityCoords?: { lat: number; lng: number },
): Promise<void> {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  // AI : Check for unsaved overlays before navigating
  const hasUnsavedOverlays = Object.values(overlayStore.overlays).some(
    (overlay) => overlay.isModified === true,
  );

  if (hasUnsavedOverlays) {
    const confirmed = confirm(t("navigation.unsavedOverlaysWarning"));
    if (!confirmed) {
      return;
    }
  }

  // AI : Clear city-specific content but preserve city markers for efficient navigation
  clearAllMapContent(true);
  const mapStore = useMapStore();
  mapStore.selectedCountryCode = countryCode;
  await loadCitiesForCountry(countryCode);

  // AI : Find the city coordinates (from store or provided coords)
  let lat: number | undefined = undefined;
  let lng: number | undefined = undefined;

  if (cityCoords) {
    // AI : Use provided coordinates (from search result)
    lat = cityCoords.lat;
    lng = cityCoords.lng;
  } else {
    // AI : Try to find in store (should now be available after prepareCountryContext)
    const country = projectStore.countries.find((c) => c.code === countryCode);
    const city = country?.cities.find((c) => c.id === cityId);
    if (city) {
      lat = city.lat;
      lng = city.lng;
    }
  }

  // AI : Fly to city coordinates if we have them
  if (lat !== undefined && lng !== undefined && map.value) {
    mobileAwareFlyTo([lat, lng], 14, {
      duration: 1.5,
    });

    // AI : Wait for the fly animation to complete before loading city data
    await new Promise<void>((resolve) => {
      map.value?.once("moveend", () => resolve());
    });
  }

  // AI : Load city projects (like clicking on city marker)
  await loadCityProjects(cityId, cityName, null, false, countryCode);
}
