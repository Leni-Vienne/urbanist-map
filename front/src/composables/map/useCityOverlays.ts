// AI : City-specific overlay management - handles loading and displaying overlays for cities
import { ref, watch } from 'vue';
import L from 'leaflet';
import { map, onMapInitialized, currentZoomLevel } from '@composables/core/useMap';
import { renderViewModeOverlays, clearAllOverlays, getFromEditModeOverlayCache } from '@composables/overlay/useOverlay';
import { cityProjectsCache, hasCachedCityProjectsData, getSelectedCity } from '@composables/map/useCityData';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import { trpc } from '@client';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import { createColorIcon } from '@composables/ui/markerIcons';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { storeToRefs } from 'pinia';
import type { OverlayData, MarkerColor } from '@types';

// AI : Function to get store refs when needed
function getStoreRefs() {
  const overlayStore = useOverlayStore();
  const { overlays, isEditMode } = storeToRefs(overlayStore);
  return { overlays, isEditMode, overlayStore };
}

// AI : Minimum zoom level required to load city projects and overlays
export const MIN_ZOOM_FOR_OVERLAYS = 12;

// AI : Current city overlays displayed
export const currentCityOverlays = ref<OverlayData[]>([]);

// AI : Layer group for overlay markers (markers without images)
let overlayMarkersLayer: L.LayerGroup | null = null;

// AI : Loading states
const isLoadingCityProjects = ref(false);

/**
 * AI : Fetch city projects data with caching to avoid repeated API calls
 */
export async function fetchCityProjectsData(cityId: string): Promise<OverlayData[]> {
  // AI : Check if we already have cached data for this city
  const cachedData = cityProjectsCache.get(cityId);
  if (cachedData) {
    return cachedData;
  }

  try {
    // AI : Backend now returns data in OverlayData format directly
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
export async function loadCityOverlays(cityId: string, cityName: string, forceFullLoad = false): Promise<void> {
  try {
    // AI : Check if user is zoomed in enough to load full overlays
    if (!map.value) {
      console.warn('AI : Map not available for zoom check');
      return;
    }

    const currentZoom = map.value.getZoom();

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

    // AI : Clear view mode overlays state using store
    const { overlayStore } = getStoreRefs();
    overlayStore.clearViewModeOverlays();

    // AI : Get overlays data (cached or fresh)
    const overlaysData = await fetchCityProjectsData(cityId);

    currentCityOverlays.value = overlaysData;

    // AI : Filter overlays based on current completion status filters
    const completionFilters = useCompletionFilters();
    const overlaysToRender = completionFilters.filterByCompletionStatus(overlaysData);

    // AI : Set overlays in view mode overlays and render them
    overlayStore.setViewModeOverlays(overlaysToRender);

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
// AI : Common function to render overlay markers from overlay data
function renderOverlayMarkersFromData(overlaysData: OverlayData[]): void {
  // AI : Clear view mode overlays state using store
  const { overlayStore } = getStoreRefs();
  overlayStore.clearViewModeOverlays();

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
}

async function showOverlayMarkers(cityId: string): Promise<void> {
  try {
    isLoadingCityProjects.value = true;

    // AI : Clear any existing overlays and markers before loading new city
    clearAllOverlays();
    removeOverlayMarkers();

    // AI : Get overlays data (cached or fresh)
    const overlaysData = await fetchCityProjectsData(cityId);

    // AI : Use shared function to render markers
    renderOverlayMarkersFromData(overlaysData);
  } catch (error) {
    console.error('AI : Error loading overlay markers:', error);
  } finally {
    isLoadingCityProjects.value = false;
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
 * AI : Get overlay data with edit modifications applied (for edit mode)
 * @param overlayData - Original overlay data
 * @returns Overlay data with edit modifications applied if in edit mode
 */
function getOverlayDataWithEditModifications(overlayData: OverlayData): OverlayData {
  const { isEditMode } = getStoreRefs();
  if (!isEditMode.value) {
    return overlayData; // AI : Return original data in view mode
  }

  // AI : Get edit modifications from the main overlay cache
  const editModifications = getFromEditModeOverlayCache(overlayData.id);
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

    // AI : Clear view mode overlays state using store
    const { overlayStore } = getStoreRefs();
    overlayStore.clearViewModeOverlays();

    currentCityOverlays.value = overlaysData;

    // AI : Filter overlays based on current completion status filters
    const completionFilters = useCompletionFilters();
    const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData);

    // AI : Set overlays in view mode overlays and render them
    overlayStore.setViewModeOverlays(visibleOverlays);

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
  console.log('AI : Rendering overlay markers from cache for city:', cityName, overlaysData);
  if (!overlaysData) {
    console.warn(`AI : No cached data found for city ${cityName}`);
    return;
  }

  try {
    // AI : Only remove overlay markers if they exist, don't clear all overlays
    removeOverlayMarkers();

    // AI : Use shared function to render markers
    renderOverlayMarkersFromData(overlaysData);
  } catch (error) {
    console.error('AI : Error rendering overlay markers from cache:', error);
  }
}

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
function getOverlayMarkerInfo(overlayData: OverlayData): { color: MarkerColor, position: { lat: number, lng: number } } {
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
  const selectedCity = getSelectedCity();

  // AI : Only update if we have overlay markers visible
  if (!overlayMarkersLayer || !map.value?.hasLayer(overlayMarkersLayer)) {
    return;
  }

  // AI : Get the current city data from cache
  if (!selectedCity || !hasCachedCityProjectsData(selectedCity.id)) {
    return;
  }

  // AI : Re-render overlay markers with current filters applied
  renderOverlayMarkersFromCache(selectedCity.id, selectedCity.name);
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

/**
 * AI : Internal function to set up zoom event listener
 */
function setupZoomEventListenerInternal(): void {
  // AI : Watch currentZoomLevel instead of listening to zoomend to avoid duplicate event handling
  watch(currentZoomLevel, (currentZoom) => {
    const selectedCity = getSelectedCity();
    if (!selectedCity) return;

    const hasCachedData = hasCachedCityProjectsData(selectedCity.id);

    // AI : Only act if we have cached data to avoid unnecessary API calls
    if (!hasCachedData) return;

    // AI : If zoomed in enough and we have overlay markers, upgrade to full overlays
    if (currentZoom >= MIN_ZOOM_FOR_OVERLAYS && overlayMarkersLayer && map.value?.hasLayer(overlayMarkersLayer)) {
      renderFullOverlaysFromCache(selectedCity.id, selectedCity.name);
    }
    // AI : If zoomed out from full overlays, show overlay markers again
    else if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && currentCityOverlays.value.length > 0) {
      // AI : Don't call clearAllOverlays() here - useOverlayModes handles clearing
      // AI : Just reset the city overlays array and show markers
      currentCityOverlays.value = [];
      renderOverlayMarkersFromCache(selectedCity.id, selectedCity.name);
    }
  });
}

// AI : Initialize zoom event listener when map is ready
onMapInitialized(() => {
  setupZoomEventListener();
});

// AI : Export loading state for external use
export { isLoadingCityProjects };