import L from "leaflet";
import { createColorIcon } from '@composables/ui/markerIcons';
import { ref, computed } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { renderViewModeOverlays, clearAllOverlays } from '@composables/overlay/useOverlay';
import { useViewModeOverlays } from '@composables/overlay/useOverlayModes';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import { trpc, RouterOutput } from '@client';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { useSelectedProject } from '@composables/project/useSelectedProject';
import { storeToRefs } from 'pinia';
import type { CDNOverlayData, MarkerColor } from '@types';
import { debounce } from '../../utils';

// AI : Function to get store refs when needed
function getStoreRefs() {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const { overlays, isEditMode } = storeToRefs(overlayStore);
  const { selectedCity } = storeToRefs(mapStore);
  const { selectedProjectId } = useSelectedProject();
  return { overlays, isEditMode, selectedProjectId, selectedCity, mapStore };
}

// AI : Function to get selected project ID when needed (kept for backward compatibility)
function getSelectedProjectId() {
  const { selectedProjectId } = useSelectedProject();
  return selectedProjectId;
}

// AI : Minimum zoom level required to load city projects and overlays
export const MIN_ZOOM_FOR_OVERLAYS = 12;
// AI : Opacity constants for city markers
const CITY_MARKER_OPACITY = 0.6; // AI : Default opacity for city markers
const CITY_MARKER_HOVER_OPACITY = 1; // AI : Opacity for city markers on hover

// AI : Type aliases using RouterOutput from tRPC
export type CityWithProjects = RouterOutput['cities']['getCitiesWithProjects'][number];

// AI : Cities with projects data
export const citiesWithProjects = ref<CityWithProjects[]>([]);

// AI : Loading states
const isLoadingCityProjects = ref(false);

// AI : Current city overlays displayed
export const currentCityOverlays = ref<CDNOverlayData[]>([]);

// AI : Layer group for city markers
let cityMarkersLayer: L.LayerGroup | null = null;

// AI : Layer group for overlay markers (markers without images)
let overlayMarkersLayer: L.LayerGroup | null = null;

// AI : Cache for city projects data to avoid repeated API calls
const cityProjectsCache = new Map<string, CDNOverlayData[]>();

// AI : Separate cache for edit mode modifications (keeps original cache pristine)
const editModeOverlayCache = new Map<string, { corners: { lat: number, lng: number }[], isModified: boolean }>();

// AI : Track the currently selected (clicked) city marker
let selectedCityMarker: L.Marker | null = null;

// AI : Initialize zoom event listener when map is ready
onMapInitialized(() => {
  setupZoomEventListener();
});

/**
 * AI : Fetch city projects data with caching to avoid repeated API calls
 */
async function fetchCityProjectsData(cityId: string): Promise<CDNOverlayData[]> {
  // AI : Check if we already have cached data for this city
  const cachedData = cityProjectsCache.get(cityId);
  if (cachedData) {
    return cachedData;
  }

  try {
    // AI : Backend now returns data in CDNOverlayData format directly
    const overlaysData = await trpc.cities.getCityProjects.query({ cityId });

    // AI : Cache the data for future use
    cityProjectsCache.set(cityId, overlaysData);
    return overlaysData;
  } catch (error) {
    console.error('Error fetching city projects data:', error);
    throw error;
  }
}

/**
 * AI : Load projects for a specific city and display overlays on map
 */
export async function loadCityProjects(cityId: string, cityName: string, forceFullLoad = false, cityCountryCode?: string): Promise<void> {
  try {
    // AI : Check if user is zoomed in enough to load full overlays
    if (!map.value) {
      console.warn('AI : Map not available for zoom check');
      return;
    }

    const currentZoom = map.value.getZoom();

    // AI : Update selected city in store
    const { mapStore } = getStoreRefs();
    mapStore.setSelectedCity({ id: cityId, name: cityName, countryCode: cityCountryCode });

    // AI : Clear selected project when switching cities
    const selectedProjectId = getSelectedProjectId();
    selectedProjectId.value = null;

    // AI : Check if we have cached data and decide what to show
    const hasCachedData = cityProjectsCache.has(cityId);
    const shouldShowFullOverlays = currentZoom >= MIN_ZOOM_FOR_OVERLAYS || forceFullLoad;

    if (hasCachedData && shouldShowFullOverlays) {
      // AI : We have cached data and zoom is high enough - show full overlays immediately
      renderFullOverlaysFromCache(cityId, cityName);
      return;
    } else if (hasCachedData && !shouldShowFullOverlays) {
      // AI : We have cached data but zoom is too low - show markers only
      renderOverlayMarkersFromCache(cityId, cityName);
      return;
    }

    // AI : No cached data - need to fetch from API
    // AI : If zoom is too low and not forcing full load, show overlay markers only
    if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && !forceFullLoad) {
      await showOverlayMarkers(cityId);
      return;
    }

    // AI : Load full overlays
    isLoadingCityProjects.value = true;

    // AI : Clear any existing overlays and markers before loading new city
    clearAllOverlays();
    removeOverlayMarkers();

    // AI : Clear view mode overlays state
    const { stopCameraTracking } = useViewModeOverlays();
    stopCameraTracking();

    // AI : Get overlays data (cached or fresh)
    const overlaysData = await fetchCityProjectsData(cityId);

    currentCityOverlays.value = overlaysData;

    // AI : Filter overlays based on current completion status filters
    const completionFilters = useCompletionFilters();
    const overlaysToRender = completionFilters.filterByCompletionStatus(overlaysData);

    // AI : Set overlays in view mode overlays and render them
    const { setViewModeOverlays } = useViewModeOverlays();
    setViewModeOverlays(overlaysToRender);

    // AI : Render only visible overlays on the map with markers
    renderViewModeOverlays(overlaysToRender, true, true);

    // AI : Check zoom level after loading to ensure overlays are hidden if zoom is too low
    checkZoomAndHideOverlays();
  } catch (error) {
    console.error('AI : Error loading city projects:', error);
    currentCityOverlays.value = [];
  } finally {
    isLoadingCityProjects.value = false;
  }
}

/**
 * AI : Show overlay markers without loading images for performance
 */
async function showOverlayMarkers(cityId: string): Promise<void> {
  try {
    isLoadingCityProjects.value = true;

    // AI : Clear any existing overlays and markers before loading new city
    clearAllOverlays();
    removeOverlayMarkers();

    // AI : Clear view mode overlays state
    const { stopCameraTracking } = useViewModeOverlays();
    stopCameraTracking();

    // AI : Get overlays data (cached or fresh)
    const overlaysData = await fetchCityProjectsData(cityId);

    // AI : Filter overlays based on current completion status filters
    const completionFilters = useCompletionFilters();
    const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData);

    // AI : Create new layer group for overlay markers
    overlayMarkersLayer = L.layerGroup();

    // AI : Add simple markers for each visible overlay location
    visibleOverlays.forEach(overlay => {
      // AI : Use getOverlayMarkerInfo which considers edit mode, current overlay state, and position
      const { color: markerColor, position } = getOverlayMarkerInfo(overlay);
      const markerIcon = createColorIcon(markerColor);
      const marker = L.marker([position.lat, position.lng], { icon: markerIcon });

      // AI : Add data-testid to the marker element after it's added to the DOM
      marker.on('add', () => {
        const markerElement = marker.getElement();
        if (markerElement) {
          markerElement.setAttribute('data-testid', `overlay-marker-${overlay.id}`);
          markerElement.setAttribute('data-overlay-id', overlay.id);
          markerElement.setAttribute('data-project-id', overlay.projectId ?? 'unknown');
          markerElement.setAttribute('data-overlay-status', overlay.project?.status ?? 'unknown');
        }
      });

      overlayMarkersLayer!.addLayer(marker);
    });

    // AI : Add overlay markers to map
    if (map.value) {
      overlayMarkersLayer.addTo(map.value);
    }
  } catch (error) {
    console.error('AI : Error loading overlay markers:', error);
  } finally {
    isLoadingCityProjects.value = false;
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
 * AI : Remove overlay markers from the map
 */
export function removeOverlayMarkers(): void {
  if (map.value && overlayMarkersLayer) {
    map.value.removeLayer(overlayMarkersLayer);
    overlayMarkersLayer = null;
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

/**
 * AI : Get overlay data with edit modifications applied (for edit mode)
 * @param overlayData - Original overlay data
 * @returns Overlay data with edit modifications applied if in edit mode
 */
function getOverlayDataWithEditModifications(overlayData: CDNOverlayData): CDNOverlayData {
  const { isEditMode } = getStoreRefs();
  if (!isEditMode.value) {
    return overlayData; // AI : Return original data in view mode
  }

  const editModifications = editModeOverlayCache.get(overlayData.id);
  if (editModifications) {
    // AI : Apply edit modifications
    return {
      ...overlayData,
      corners: editModifications.corners,
      isModified: editModifications.isModified
    };
  }

  return overlayData; // AI : No modifications found
}

/**
 * AI : Render full overlays from cached data
 */
function renderFullOverlaysFromCache(cityId: string, cityName: string) {
  const overlaysData = cityProjectsCache.get(cityId);
  if (!overlaysData) {
    console.warn(`AI : No cached data found for city ${cityName}`);
    return;
  }

  try {
    // AI : Clear any existing overlays and markers before loading
    clearAllOverlays();
    removeOverlayMarkers();

    // AI : Clear view mode overlays state
    const { stopCameraTracking } = useViewModeOverlays();
    stopCameraTracking();

    currentCityOverlays.value = overlaysData;

    // AI : Filter overlays based on current completion status filters
    const completionFilters = useCompletionFilters();
    const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData);

    // AI : Set overlays in view mode overlays and render them
    const { setViewModeOverlays } = useViewModeOverlays();
    setViewModeOverlays(visibleOverlays);

    // AI : Render only visible overlays on the map with markers
    renderViewModeOverlays(visibleOverlays, true, true);
  } catch (error) {
    console.error('AI : Error rendering full overlays from cache:', error);
  }
}

/**
 * AI : Render overlay markers from cached data
 */
export function renderOverlayMarkersFromCache(cityId: string, cityName: string): void {
  const overlaysData = cityProjectsCache.get(cityId);
  if (!overlaysData) {
    console.warn(`AI : No cached data found for city ${cityName}`);
    return;
  }

  try {
    // AI : Only remove overlay markers if they exist, don't clear all overlays
    removeOverlayMarkers();

    // AI : Clear view mode overlays state
    const { stopCameraTracking } = useViewModeOverlays();
    stopCameraTracking();

    // AI : Filter overlays based on current completion status filters
    const completionFilters = useCompletionFilters();
    const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData);

    // AI : Create new layer group for overlay markers
    overlayMarkersLayer = L.layerGroup();

    // AI : Add simple markers for each visible overlay location
    visibleOverlays.forEach(overlay => {
      // AI : Use getOverlayMarkerInfo which considers edit mode, current overlay state, and position
      const { color: markerColor, position } = getOverlayMarkerInfo(overlay);
      const markerIcon = createColorIcon(markerColor);
      const marker = L.marker([position.lat, position.lng], { icon: markerIcon });

      // AI : Add data-testid to the marker element after it's added to the DOM
      marker.on('add', () => {
        const markerElement = marker.getElement();
        if (markerElement) {
          markerElement.setAttribute('data-testid', `overlay-marker-${overlay.id}`);
          markerElement.setAttribute('data-overlay-id', overlay.id);
          markerElement.setAttribute('data-project-id', overlay.projectId ?? 'unknown');
          markerElement.setAttribute('data-overlay-status', overlay.project?.status ?? 'unknown');
        }
      });

      overlayMarkersLayer!.addLayer(marker);
    });

    // AI : Add overlay markers to map
    if (map.value) {
      overlayMarkersLayer.addTo(map.value);
    }
  } catch (error) {
    console.error('AI : Error rendering overlay markers from cache:', error);
  }
}

/**
 * AI : Set up zoom event listener to upgrade overlay markers to full overlays
 */
function setupZoomEventListener(): void {
  if (!map.value) {
    onMapInitialized(() => {
      setupZoomEventListenerInternal();
    });
    return;
  }
  setupZoomEventListenerInternal();
}

// AI : Combined zoom handler for both cleanup and live overlay rendering
const combinedZoomHandler = debounce(() => {
  if (!map.value) return;

  const currentZoom = map.value.getZoom();

  // AI : Immediate cleanup for very low zoom levels
  if (currentZoom < MIN_ZOOM_FOR_OVERLAYS - 2 && currentCityOverlays.value.length > 0) {
    clearAllOverlays();
    currentCityOverlays.value = [];
    return; // AI : Exit early if we cleared overlays
  }

  // AI : Live overlay rendering during zoom
  const { selectedCity } = getStoreRefs();
  if (!selectedCity.value) return;

  const hasCachedData = cityProjectsCache.has(selectedCity.value.id);
  if (!hasCachedData) return;

  // AI : If zoomed in enough and we have overlay markers, upgrade to full overlays during zoom
  if (currentZoom >= MIN_ZOOM_FOR_OVERLAYS && overlayMarkersLayer && map.value.hasLayer(overlayMarkersLayer)) {
    renderFullOverlaysFromCache(selectedCity.value.id, selectedCity.value.name);
  }
}, 200); // AI : 200ms debounce for responsive live updates during pinch-to-zoom

/**
 * AI : Internal function to set up zoom event listener
 */
function setupZoomEventListenerInternal(): void {
  if (!map.value) return;

  // AI : Single zoom event listener that handles both cleanup and live rendering
  map.value.on('zoom', combinedZoomHandler);

  map.value.on('zoomend', () => {
    if (!map.value) return;

    const { selectedCity } = getStoreRefs();
    if (!selectedCity.value) return;

    const currentZoom = map.value.getZoom();
    const hasCachedData = cityProjectsCache.has(selectedCity.value.id);

    // AI : Only act if we have cached data to avoid unnecessary API calls
    if (!hasCachedData) return;

    // AI : If zoomed in enough and we have overlay markers, upgrade to full overlays
    if (currentZoom >= MIN_ZOOM_FOR_OVERLAYS && overlayMarkersLayer && map.value.hasLayer(overlayMarkersLayer)) {
      renderFullOverlaysFromCache(selectedCity.value.id, selectedCity.value.name);
    }
    // AI : If zoomed out from full overlays, show overlay markers again
    else if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && currentCityOverlays.value.length > 0) {
      // AI : Clear current overlays first
      clearAllOverlays();
      currentCityOverlays.value = [];
      // AI : Then show overlay markers
      renderOverlayMarkersFromCache(selectedCity.value.id, selectedCity.value.name);
    }
  });
}

// AI : Initialize zoom event listener when map is ready
onMapInitialized(() => {
  setupZoomEventListener();
});

/**
 * AI : Check current zoom and hide overlays if needed
 */
export function checkZoomAndHideOverlays(): void {
  if (!map.value) return;

  const currentZoom = map.value.getZoom();

  if (currentZoom < MIN_ZOOM_FOR_OVERLAYS) {
    clearAllOverlays();
    currentCityOverlays.value = [];
  }
}


/**
 * AI : Get marker color and position based on overlay state, considering edit mode and current overlay status
 * @param overlayData - The CDN overlay data
 * @returns Object with marker color and position
 */
function getOverlayMarkerInfo(overlayData: CDNOverlayData): { color: MarkerColor, position: { lat: number, lng: number } } {
  let position = { lat: overlayData.centroid.lat, lng: overlayData.centroid.lng };
  // AI : Check if we're in edit mode and if the overlay exists in the overlays store
  const { isEditMode, overlays } = getStoreRefs();
  if (isEditMode.value) {
    const overlayObject = overlays.value[overlayData.id];

    if (overlayObject) {
      // AI : Use current overlay position if it has been moved
      if (overlayObject.corners && overlayObject.corners.length >= 4) {
        // AI : Calculate center from current corners - Leaflet distortable uses: NW, NE, SW, SE
        // AI : Center should be between NW (corners[0]) and SE (corners[3])
        const centerLat = (overlayObject.corners[0].lat + overlayObject.corners[3].lat) / 2;
        const centerLng = (overlayObject.corners[0].lng + overlayObject.corners[3].lng) / 2;
        position = { lat: centerLat, lng: centerLng };
      }

      // AI : Use centralized color logic
      const color = getOverlayMarkerColor(overlayObject, 'edit');
      return { color, position };
    } else {
      // AI : No overlay object loaded, check edit cache for modifications
      const overlayDataWithMods = getOverlayDataWithEditModifications(overlayData);

      // AI : Use modified position if available
      if (overlayDataWithMods.corners && overlayDataWithMods.corners.length >= 4) {
        const centerLat = (overlayDataWithMods.corners[0].lat + overlayDataWithMods.corners[3].lat) / 2;
        const centerLng = (overlayDataWithMods.corners[0].lng + overlayDataWithMods.corners[3].lng) / 2;
        position = { lat: centerLat, lng: centerLng };
      }

      // AI : Use centralized color logic with modified data
      const color = getOverlayMarkerColor(overlayDataWithMods, 'edit');
      return { color, position };
    }
  }

  // AI : View mode - always use original cached data (no edit modifications)
  const color = getOverlayMarkerColor(overlayData, 'view');
  return { color, position };
}

/**
 * AI : Update overlay markers when completion filters change
 * This function updates markers based on current filter state (works in both edit and view mode)
 */
export function updateOverlayMarkersForFilters(): void {
  const { selectedCity } = getStoreRefs();

  // AI : Only update if we have overlay markers visible
  if (!overlayMarkersLayer || !map.value?.hasLayer(overlayMarkersLayer)) {
    return;
  }

  // AI : Get the current city data from cache
  if (!selectedCity.value || !cityProjectsCache.has(selectedCity.value.id)) {
    return;
  }

  // AI : Re-render overlay markers with current filters applied
  renderOverlayMarkersFromCache(selectedCity.value.id, selectedCity.value.name);
}


/**
 * AI : Get cached overlay data for a specific city
 * @param cityId - The city ID to get data for
 * @returns The cached overlay data or null if not found
 */
function getCachedCityProjectsData(cityId: string): CDNOverlayData[] | null {
  return cityProjectsCache.get(cityId) ?? null;
}

/**
 * AI : Check if city projects data is cached
 * @param cityId - The city ID to check
 * @returns True if data is cached, false otherwise
 */
function hasCachedCityProjectsData(cityId: string): boolean {
  return cityProjectsCache.has(cityId);
}

/**
 * AI : Get the currently selected city from the map store
 * @returns The selected city or null if none selected
 */
export function getSelectedCity() {
  const { selectedCity } = getStoreRefs();
  return selectedCity.value;
}

// AI : Backward compatibility - computed property that behaves like the old latestClickedCity
export const latestClickedCity = computed(() => getSelectedCity());

/**
 * AI : Handle city-specific logic when exiting edit mode
 * This function contains the city-related overlay re-rendering logic
 */
export function handleEditModeExit() {
  // AI : Force re-render overlays to show original backend positions instead of modified ones
  // AI : Check if we have a current city with cached data
  if (latestClickedCity.value && hasCachedCityProjectsData(latestClickedCity.value.id)) {
    const overlaysData = getCachedCityProjectsData(latestClickedCity.value.id)!;

    // AI : Clear all current overlays first
    clearAllOverlays();

    // AI : Check current zoom level to decide what to render
    const currentZoom = map.value?.getZoom() ?? 0;

    if (currentZoom >= MIN_ZOOM_FOR_OVERLAYS) {
      // AI : Zoom is high enough for full overlays
      const { setViewModeOverlays } = useViewModeOverlays();
      setViewModeOverlays(overlaysData);

      // AI : Filter overlays based on current completion status filters
      const completionFilters = useCompletionFilters();
      const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData);

      // AI : Render the overlays on the map
      renderViewModeOverlays(visibleOverlays, true, true)
    } else {
      // AI : Zoom is too low, render markers only (view mode markers)
      renderOverlayMarkersFromCache(latestClickedCity.value.id, latestClickedCity.value.name);
    }

    // AI : Update overlay markers colors for view mode (when zoomed out)
    updateOverlayMarkersForFilters();
  }
}
