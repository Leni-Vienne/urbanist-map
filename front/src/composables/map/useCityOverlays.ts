// AI : City-specific overlay management - handles loading and displaying overlays for cities
import { ref, watch } from 'vue';
import L from 'leaflet';
import { map, onMapInitialized, currentZoomLevel } from '@composables/core/useMap';
import { renderViewModeOverlays, clearAllOverlays } from '@composables/overlay/useOverlay';
import { getOverlayDataWithEditModifications } from '@composables/overlay/useOverlayEditCache';
import { hasCachedCityProjectsData, getSelectedCity } from '@composables/map/useCityData';
import { calculateCenterFromCorners } from '../../utils/typeFactories';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import { trpc } from '@client';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import { createColorIcon } from '@composables/ui/markerIcons';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { withErrorHandling, withErrorToast } from '@composables/core/useErrorHandling';
import type { OverlayData, MarkerColor } from '@types';

// AI : Minimum zoom level required to load city projects and overlays
const MIN_ZOOM_FOR_OVERLAYS = 12;

// AI : Layer group for overlay markers (markers without images)
let overlayMarkersLayer: L.LayerGroup | null = null;

// AI : Loading states
const isLoadingCityProjects = ref(false);

/**
 * AI : Fetch city projects data with caching to avoid repeated API calls
 */
export async function fetchCityProjectsData(cityId: string): Promise<OverlayData[]> {
  const mapStore = useMapStore();

  // AI : Check if we already have cached data for this city
  const cachedData = mapStore.getCityProjectsCache(cityId);
  if (cachedData) {
    return cachedData;
  }

  // AI : Backend now returns data in OverlayData format directly
  const overlaysData = await withErrorToast(
    () => trpc.cities.getCityProjects.query({ cityId }),
    'Error fetching city projects data'
  );

  // AI : Cache the data for future use in store
  mapStore.setCityProjectsCache(cityId, overlaysData);
  return overlaysData;
}

/**
 * AI : Load projects for a specific city and display overlays on map
 */
export async function loadCityOverlays(cityId: string, forceFullLoad = false): Promise<void | null> {
  return withErrorHandling(
    async () => {
      const mapStore = useMapStore();

      // AI : Check if user is zoomed in enough to load full overlays
      if (!map.value) {
        return;
      }

      const currentZoom = map.value.getZoom();

      // AI : Check if we have cached data and decide what to show
      const hasCachedData = hasCachedCityProjectsData(cityId);
      const shouldShowFullOverlays = currentZoom >= MIN_ZOOM_FOR_OVERLAYS || forceFullLoad;

      if (hasCachedData && shouldShowFullOverlays) {
        // AI : We have cached data and zoom is high enough - show full overlays immediately
        renderFullOverlaysFromCache(cityId);
        return;
      } else if (hasCachedData && !shouldShowFullOverlays) {
        // AI : We have cached data but zoom is too low - show markers only
        renderOverlayMarkersFromCache(cityId);
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
      const overlayStore = useOverlayStore();
      overlayStore.clearViewModeOverlays();

      // AI : Get overlays data (cached or fresh)
      const overlaysData = await fetchCityProjectsData(cityId);

      mapStore.currentCityOverlays = overlaysData;

      // AI : Filter overlays based on current completion status filters
      const completionFilters = useCompletionFilters();
      const overlaysToRender = completionFilters.filterByCompletionStatus(overlaysData);

      // AI : Set overlays in view mode overlays and render them
      overlayStore.setViewModeOverlays(overlaysToRender);

      // AI : Render only visible overlays on the map with markers
      renderViewModeOverlays(overlaysToRender, true, true);

      // AI : Check zoom level after loading to ensure overlays are hidden if zoom is too low
      checkZoomAndHideOverlays();
    },
    {
      errorMessage: 'Failed to load city overlays',
      logError: true,
      onError: () => {
        const mapStore = useMapStore();
        mapStore.currentCityOverlays = [];
        isLoadingCityProjects.value = false;
      }
    }
  );
}

// AI : Common function to render overlay markers from overlay data
function renderOverlayMarkersFromData(overlaysData: OverlayData[]): void {
  // AI : Clear view mode overlays state using store
  const overlayStore = useOverlayStore();
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
  return withErrorHandling(
    async () => {
      isLoadingCityProjects.value = true;

      // AI : Clear any existing overlays and markers before loading new city
      clearAllOverlays();
      removeOverlayMarkers();

      // AI : Get overlays data (cached or fresh)
      const overlaysData = await fetchCityProjectsData(cityId);

      // AI : Use shared function to render markers
      renderOverlayMarkersFromData(overlaysData);
    },
    {
      errorMessage: 'Failed to load overlay markers',
      logError: true,
      onError: () => {
        isLoadingCityProjects.value = false;
      }
    }
  ) as Promise<void>;
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

// AI : getOverlayDataWithEditModifications is now imported from useOverlayEditCache

/**
 * AI : Render full overlays from cached data
 */
function renderFullOverlaysFromCache(cityId: string) {
  const mapStore = useMapStore();
  const overlaysData = mapStore.getCityProjectsCache(cityId);
  if (!overlaysData) {
    return;
  }

  withErrorHandling(
    async () => {
      // AI : Clear any existing overlays and markers before loading
      clearAllOverlays();
      removeOverlayMarkers();

      // AI : Clear view mode overlays state using store
      const overlayStore = useOverlayStore();
      overlayStore.clearViewModeOverlays();

      mapStore.currentCityOverlays = overlaysData;

      // AI : Filter overlays based on current completion status filters
      const completionFilters = useCompletionFilters();
      const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData);

      // AI : Set overlays in view mode overlays and render them
      overlayStore.setViewModeOverlays(visibleOverlays);

      // AI : Render only visible overlays on the map with markers
      renderViewModeOverlays(visibleOverlays, true, true);
    },
    { errorMessage: 'Failed to render cached overlays', logError: true }
  );
}

/**
 * AI : Render overlay markers from cached data
 */
export function renderOverlayMarkersFromCache(cityId: string): void {
  const mapStore = useMapStore();
  const overlaysData = mapStore.getCityProjectsCache(cityId);
  if (!overlaysData) {
    return;
  }

  withErrorHandling(
    async () => {
      // AI : Only remove overlay markers if they exist, don't clear all overlays
      removeOverlayMarkers();

      // AI : Use shared function to render markers
      renderOverlayMarkersFromData(overlaysData);
    },
    { errorMessage: 'Failed to render cached overlay markers', logError: true }
  );
}

/**
 * AI : Check current zoom and hide overlays if needed
 */
export function checkZoomAndHideOverlays(): void {
  const mapStore = useMapStore();

  if (!map.value) return;

  const currentZoom = map.value.getZoom();

  if (currentZoom < MIN_ZOOM_FOR_OVERLAYS) {
    clearAllOverlays();
    mapStore.currentCityOverlays = [];
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
  const overlayStore = useOverlayStore();
  if (overlayStore.isEditMode) {
    const overlayObject = overlayStore.overlays[overlayData.id];

    if (overlayObject) {
      // AI : Use current overlay position if it has been moved
      const calculatedCenter = calculateCenterFromCorners(overlayObject.corners);
      if (calculatedCenter) {
        position = calculatedCenter;
      }

      // AI : Use centralized color logic
      const color = getOverlayMarkerColor(overlayObject, 'edit');
      return { color, position };
    } else {
      // AI : No overlay object loaded, check edit cache for modifications
      const overlayDataWithMods = getOverlayDataWithEditModifications(overlayData);

      // AI : Use modified position if available
      const calculatedCenter = calculateCenterFromCorners(overlayDataWithMods.corners);
      if (calculatedCenter) {
        position = calculatedCenter;
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
  renderOverlayMarkersFromCache(selectedCity.id);
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
  const mapStore = useMapStore();

  // AI : Watch currentZoomLevel instead of listening to zoomend to avoid duplicate event handling
  watch(currentZoomLevel, (currentZoom) => {
    const selectedCity = getSelectedCity();
    if (!selectedCity) return;

    const hasCachedData = hasCachedCityProjectsData(selectedCity.id);

    // AI : Only act if we have cached data to avoid unnecessary API calls
    if (!hasCachedData) return;

    // AI : If zoomed in enough and we have overlay markers, upgrade to full overlays
    if (currentZoom >= MIN_ZOOM_FOR_OVERLAYS && overlayMarkersLayer && map.value?.hasLayer(overlayMarkersLayer)) {
      renderFullOverlaysFromCache(selectedCity.id);
    }
    // AI : If zoomed out from full overlays, show overlay markers again
    else if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && mapStore.currentCityOverlays.length > 0) {
      // AI : Don't call clearAllOverlays() here - useOverlayModes handles clearing
      // AI : Just reset the city overlays array and show markers
      mapStore.currentCityOverlays = [];
      renderOverlayMarkersFromCache(selectedCity.id);
    }
  });
}

// AI : Initialize zoom event listener when map is ready
onMapInitialized(() => {
  setupZoomEventListener();
});

// AI : Export loading state for external use
export { isLoadingCityProjects };