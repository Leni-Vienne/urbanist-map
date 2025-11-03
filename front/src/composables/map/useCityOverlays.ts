// AI : City-specific overlay management - handles loading and displaying overlays for cities
import { ref } from 'vue';
import L from 'leaflet';
import { map } from '@composables/core/useMap';
import { renderViewModeOverlays, clearAllOverlays } from '@composables/overlay/useOverlay';
import { hasCachedCityProjectsData, getSelectedCity } from '@composables/map/useCityData';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import { trpc } from '@client';
import { getOverlayMarkerColor, createColorIcon } from '@composables/map/useMarkers';
import { resolveOverlayPosition } from '@composables/overlay/useOverlayPositionManagement';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { withErrorHandling, withErrorToast } from '@composables/core/useErrorHandling';
import { mobileAwareFlyToBounds } from '@composables/map/useMapNavigation';
import type { OverlayData } from '@types';
import { MAP_CONFIG } from '@constants/mapConstants';

// AI : Minimum zoom level required to load city projects and overlays
const MIN_ZOOM_FOR_OVERLAYS = MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;

// AI : Layer group for overlay markers (markers without images)
let overlayMarkersLayer: L.LayerGroup | null = null;

// AI : Loading states
const isLoadingCityProjects = ref(false);

/**
 * AI : Fetch city projects data with mode-aware caching to avoid repeated API calls
 * AI : Smart caching: Returns cached data if available for current mode, otherwise fetches from backend
 */
export async function fetchCityProjectsData(cityId: string): Promise<OverlayData[]> {
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();

  // AI : Check if we already have cached data for this city AND current mode
  const cachedData = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode);
  if (cachedData) {
    return cachedData;
  }

  // AI : Backend now returns data in OverlayData format with consistent fields:
  // AI : - corners = ALWAYS approved position
  // AI : - suggestedCorners = pending changes if they exist
  const overlaysData = await withErrorToast(
    () => trpc.cities.getCityOverlaysAndProjects.query({ cityId, mode: overlayStore.mode }),
    'Error fetching city projects data'
  );

  // AI : Cache the data for future use - mode-specific cache
  mapStore.setCityProjectsCache(cityId, overlayStore.mode, overlaysData);

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

      // AI : Check if we have cached data for current mode and decide what to show
      const overlayStore = useOverlayStore();
      const hasCachedData = hasCachedCityProjectsData(cityId, overlayStore.mode);
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
    // AI : Use unified position resolver
    const overlayStore = useOverlayStore();
    const resolved = resolveOverlayPosition(overlay.id, overlay, overlayStore.mode);
    const markerColor = getOverlayMarkerColor(overlay, overlayStore.mode);
    const markerIcon = createColorIcon(markerColor);
    const marker = L.marker([resolved.position.lat, resolved.position.lng], { icon: markerIcon });

    // AI : Add click handler to fly to overlay position
    marker.on('click', () => {
      flyToOverlayMarker(overlay);
    });

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
  if (map.value != null) {
    overlayMarkersLayer.addTo(map.value);
  }
}

async function showOverlayMarkers(cityId: string): Promise<void> {
  return withErrorHandling(
    async () => {
      const mapStore = useMapStore();
      isLoadingCityProjects.value = true;

      // AI : Clear any existing overlays and markers before loading new city
      clearAllOverlays();
      removeOverlayMarkers();

      // AI : Get overlays data (cached or fresh)
      const overlaysData = await fetchCityProjectsData(cityId);

      // AI : Store overlay data for navigation (even though we're only showing markers)
      mapStore.currentCityOverlays = overlaysData;

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
 * AI : Render full overlays from cached data for current mode
 */
function renderFullOverlaysFromCache(cityId: string) {
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();
  const overlaysData = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode);
  if (!overlaysData) {
    return;
  }

  withErrorHandling(
    () => {
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
 * AI : Render overlay markers from cached data for current mode
 */
export function renderOverlayMarkersFromCache(cityId: string): void {
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();
  const overlaysData = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode);
  if (!overlaysData) {
    return;
  }

  withErrorHandling(
    () => {
      // AI : Store overlay data for navigation (even though we're only showing markers)
      mapStore.currentCityOverlays = overlaysData;

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
  if (!map.value) return;

  const currentZoom = map.value.getZoom();

  if (currentZoom < MIN_ZOOM_FOR_OVERLAYS) {
    // AI : Clear overlays from map when zoom is too low
    clearAllOverlays();
    // AI : Note: We don't clear mapStore.currentCityOverlays because it's needed for navigation
  }
}

/**
 * AI : Fly to overlay marker position with appropriate zoom level
 */
async function flyToOverlayMarker(overlayData: OverlayData): Promise<void> {
  if (!map.value) return;
  
  const overlayStore = useOverlayStore();

  // AI : Use unified position resolver to get corners
  const resolved = resolveOverlayPosition(overlayData.id, overlayData, overlayStore.mode);
  
  if (resolved.corners && resolved.corners.length === 4) {
    // AI : Create bounds from resolved corners
    const leafletCorners = resolved.corners.map(corner => L.latLng(corner.lat, corner.lng));
    const bounds = L.latLngBounds(leafletCorners);

    // AI : Fly to bounds with padding
    mobileAwareFlyToBounds(bounds, {
      padding: [50, 50] as [number, number],
      duration: 1.5,
      easeLinearity: 0.25
    });
  }
}

// AI : Old getOverlayMarkerInfo function removed - now using unified resolveOverlayPosition from useOverlayPosition

/**
 * AI : Update overlay markers when completion filters change
 * This function updates markers based on current filter state (works in both edit and view mode)
 */
export function updateOverlayMarkersForFilters(): void {
  const selectedCity = getSelectedCity();
  const overlayStore = useOverlayStore();

  // AI : Only update if we have overlay markers visible
  if (!overlayMarkersLayer || map.value != null && !map.value.hasLayer(overlayMarkersLayer)) {
    return;
  }

  // AI : Get the current city data from cache for current mode
  if (!selectedCity || !hasCachedCityProjectsData(selectedCity.id, overlayStore.mode)) {
    return;
  }

  // AI : Re-render overlay markers with current filters applied
  renderOverlayMarkersFromCache(selectedCity.id);
}

// AI : Export loading state for external use
export { isLoadingCityProjects };
