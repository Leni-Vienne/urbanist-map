import L from "leaflet";
import { createColorIcon } from '@composables/ui/colorMarkers';
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { renderViewModeOverlays, clearAllOverlays } from '@composables/overlay/useOverlay';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import { selectedProjectId } from '@stores/projectStore';
import { overlays, isEditMode } from '@stores/overlayStore';
import { trpc, RouterOutput } from '@client';
import type { CDNOverlayData } from '@types';

// AI : Minimum zoom level required to load city projects and overlays
const MIN_ZOOM_FOR_OVERLAYS = 12;
// AI : Opacity constants for city markers
const CITY_MARKER_OPACITY = 0.6; // AI : Default opacity for city markers
const CITY_MARKER_HOVER_OPACITY = 1; // AI : Opacity for city markers on hover

// AI : Type aliases using RouterOutput from tRPC
export type CityWithProjects = RouterOutput['cities']['getCitiesWithProjects'][number];

// AI : Cities with projects data
export const citiesWithProjects = ref<CityWithProjects[]>([]);

// AI : Loading states
export const isLoadingCities = ref(false);
export const isLoadingCityProjects = ref(false);

// AI : Current city overlays displayed
export const currentCityOverlays = ref<CDNOverlayData[]>([]);

// AI : Layer group for city markers
let cityMarkersLayer: L.LayerGroup | null = null;

// AI : Layer group for overlay markers (markers without images)
let overlayMarkersLayer: L.LayerGroup | null = null;

// AI : Track the latest clicked city for two-stage loading
export let latestClickedCity: { id: string; name: string; countryCode?: string } | null = null;

// AI : Cache for city projects data to avoid repeated API calls
const cityProjectsCache = new Map<string, CDNOverlayData[]>();

// AI : Mouse tooltip element for guidance
let mouseTooltip: HTMLElement | null = null;

// AI : Track the currently selected (clicked) city marker
let selectedCityMarker: L.Marker | null = null;

// AI : Initialize zoom event listener when map is ready
onMapInitialized(() => {
  setupZoomEventListener();
});

/**
 * AI : Fetch city projects data with caching to avoid repeated API calls
 */
async function fetchCityProjectsData(cityId: string, cityName: string, cityCountryCode?: string): Promise<CDNOverlayData[]> {
  // AI : Check if we already have cached data for this city
  const cachedData = cityProjectsCache.get(cityId);
  if (cachedData) {
    console.log(`AI : Using cached data for city ${cityName} (${cachedData.length} overlays)`);
    return cachedData;
  }

  try {
    console.log(`AI : Fetching city projects data for ${cityName}...`);
    const result = await trpc.cities.getCityProjects.query({ cityId });

    // AI : Convert project overlays to CDN overlay format
    const overlaysData: CDNOverlayData[] = [];
    result.forEach(project => {
      // AI : Handle overlays as JSON array returned by backend
      const overlaysArray = project.overlays as any[] ?? [];
      overlaysArray.forEach((overlay: any) => {
        // AI : Validate overlay coordinates before adding
        if (!overlay.topLeftLat || !overlay.topLeftLng ||
          !overlay.topRightLat || !overlay.topRightLng ||
          !overlay.bottomRightLat || !overlay.bottomRightLng ||
          !overlay.bottomLeftLat || !overlay.bottomLeftLng) {
          console.warn('AI : Skipping overlay with invalid coordinates:', overlay.id);
          return;
        }

        overlaysData.push({
          id: overlay.id,
          filename: overlay.filename,
          caption: overlay.caption,
          projectId: project.id,
          project: {
            ...project,
            city: cityCountryCode ? {
              id: cityId,
              name: cityName,
              countryCode: cityCountryCode,
              coordinates: { x: 0, y: 0 }, // AI : Placeholder coordinates
              createdAt: new Date(),
              updatedAt: new Date(),
            } : null, // AI : Include city data when available
          },
          centroid: {
            lat: overlay.centroidLat ?? overlay.lat,
            lng: overlay.centroidLng ?? overlay.lng
          },
          corners: [
            { lat: overlay.topLeftLat, lng: overlay.topLeftLng },
            { lat: overlay.topRightLat, lng: overlay.topRightLng },
            { lat: overlay.bottomRightLat, lng: overlay.bottomRightLng },
            { lat: overlay.bottomLeftLat, lng: overlay.bottomLeftLng }
          ],
          distance: 0,
          createdAt: overlay.createdAt
        });
      });
    });

    // AI : Cache the data for future use
    cityProjectsCache.set(cityId, overlaysData);
    console.log(`AI : Cached ${overlaysData.length} overlays for city ${cityName}`);
    
    return overlaysData;
  } catch (error) {
    console.error('AI : Error fetching city projects data:', error);
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

    // AI : Update latest clicked city
    latestClickedCity = { id: cityId, name: cityName, countryCode: cityCountryCode };

    // AI : Clear selected project when switching cities
    selectedProjectId.value = null;

    // AI : Check if we have cached data and decide what to show
    const hasCachedData = cityProjectsCache.has(cityId);
    const shouldShowFullOverlays = currentZoom >= MIN_ZOOM_FOR_OVERLAYS || forceFullLoad;

    if (hasCachedData && shouldShowFullOverlays) {
      // AI : We have cached data and zoom is high enough - show full overlays immediately
      console.log(`AI : Showing full overlays for ${cityName} from cache (zoom: ${currentZoom})`);
      await renderFullOverlaysFromCache(cityId, cityName);
      return;
    } else if (hasCachedData && !shouldShowFullOverlays) {
      // AI : We have cached data but zoom is too low - show markers only
      console.log(`AI : Showing overlay markers for ${cityName} from cache (zoom: ${currentZoom})`);
      renderOverlayMarkersFromCache(cityId, cityName);
      return;
    }

    // AI : No cached data - need to fetch from API
    // AI : If zoom is too low and not forcing full load, show overlay markers only
    if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && !forceFullLoad) {
      console.log(`AI : Zoom level ${currentZoom} too low to load full overlays for ${cityName}. Showing markers only.`);
      await showOverlayMarkers(cityId, cityName, cityCountryCode);
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
    const overlaysToRender = await fetchCityProjectsData(cityId, cityName, cityCountryCode);

    currentCityOverlays.value = overlaysToRender;

    // AI : Set overlays in view mode overlays and render them
    const { setViewModeOverlays } = useViewModeOverlays();
    setViewModeOverlays(overlaysToRender);

    // AI : Render overlays on the map with markers
    await renderViewModeOverlays(overlaysToRender, true, true);

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
async function showOverlayMarkers(cityId: string, cityName: string, cityCountryCode?: string): Promise<void> {
  try {
    isLoadingCityProjects.value = true;

    // AI : Clear any existing overlays and markers before loading new city
    clearAllOverlays();
    removeOverlayMarkers();

    // AI : Clear view mode overlays state
    const { stopCameraTracking } = useViewModeOverlays();
    stopCameraTracking();

    // AI : Get overlays data (cached or fresh)
    const overlaysData = await fetchCityProjectsData(cityId, cityName, cityCountryCode);

    // AI : Create new layer group for overlay markers
    overlayMarkersLayer = L.layerGroup();

    // AI : Add simple markers for each overlay location, color depends on overlay state in edit mode or project status in view mode
    overlaysData.forEach(overlay => {
      // AI : Use getOverlayMarkerInfo which considers edit mode, current overlay state, and position
      const { color: markerColor, position } = getOverlayMarkerInfo(overlay);
      const markerIcon = createColorIcon(markerColor);
      const marker = L.marker([position.lat, position.lng], { icon: markerIcon });

      overlayMarkersLayer!.addLayer(marker);
    });

    // AI : Add overlay markers to map
    if (map.value) {
      overlayMarkersLayer.addTo(map.value);
    }

    console.log(`AI : Loaded ${overlaysData.length} overlay markers for ${cityName} (no images)`);
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
  if (map.value && cityMarkersLayer) {
    map.value.removeLayer(cityMarkersLayer);
    cityMarkersLayer = null;
    // AI : Hide tooltip when removing markers
    hideMouseTooltip();
  }
}

/**
 * AI : Remove overlay markers from the map
 */
function removeOverlayMarkers(): void {
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
    // AI : Create a standard Leaflet marker
    const marker = L.marker([city.lat, city.lng], {
      opacity: CITY_MARKER_OPACITY // AI : Lower default opacity to suggest interactivity
    });

    // AI : Add tooltip with city name, only on hover
    marker.bindTooltip(`${city.name}`, {
      permanent: false, // AI : Tooltip appears only on hover
    });

    // AI : Add click event to load city projects directly and set marker as selected
    marker.on('click', async () => {
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
      await loadCityProjects(city.id, city.name, false, city.countryCode);
    });

    // AI : Add mouseover event to show guidance tooltip and increase marker opacity
    marker.on('mouseover', (event) => {
      createMouseTooltip();
      showMouseTooltip(event.originalEvent);
      // AI : Only increase opacity if not selected
      if (selectedCityMarker !== marker) {
        marker.setOpacity(CITY_MARKER_HOVER_OPACITY);
      }
    });

    // AI : Add mousemove event to update tooltip position
    marker.on('mousemove', (event) => {
      updateMouseTooltipPosition(event.originalEvent);
    });

    // AI : Add mouseout event to hide guidance tooltip and reset marker opacity if not selected
    marker.on('mouseout', () => {
      hideMouseTooltip();
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
 * AI : Toggle city markers visibility
 */
export function toggleCityMarkers(): void {
  if (cityMarkersLayer && map.value) {
    if (map.value.hasLayer(cityMarkersLayer)) {
      removeCityMarkers();
    } else {
      cityMarkersLayer.addTo(map.value);
    }
  }
}

/**
 * AI : Check if city markers are currently visible on the map
 */
export function areCityMarkersVisible(): boolean {
  return cityMarkersLayer !== null && map.value !== null && map.value.hasLayer(cityMarkersLayer);
}

/**
 * AI : Clean up mouse tooltip element
 */
function cleanupMouseTooltip(): void {
  if (mouseTooltip) {
    document.body.removeChild(mouseTooltip);
    mouseTooltip = null;
  }
}

/**
 * AI : Clear city projects cache
 */
export function clearCityProjectsCache(): void {
  cityProjectsCache.clear();
  console.log('AI : City projects cache cleared');
}

/**
 * AI : Clear cache for a specific city
 */
export function clearCityProjectsCacheForCity(cityId: string): void {
  cityProjectsCache.delete(cityId);
  console.log(`AI : Cache cleared for city ${cityId}`);
}

/**
 * AI : Cleanup city markers system
 */
export function cleanupCityMarkers(): void {
  removeCityMarkers();
  removeOverlayMarkers();
  cleanupMouseTooltip();
  clearCityProjectsCache();
  latestClickedCity = null;
}

/**
 * AI : Create and initialize mouse tooltip element
 */
function createMouseTooltip(): void {
  if (mouseTooltip) return;

  mouseTooltip = document.createElement('div');
  mouseTooltip.style.cssText = `
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
  mouseTooltip.textContent = 'Click on a city marker to view its projects';
  document.body.appendChild(mouseTooltip);
}

/**
 * AI : Show mouse tooltip at cursor position
 */
function showMouseTooltip(event: MouseEvent): void {
  if (!mouseTooltip) return;

  mouseTooltip.style.left = event.clientX + 15 + 'px';
  mouseTooltip.style.top = event.clientY - 10 + 'px';
  mouseTooltip.style.opacity = '1';
}

/**
 * AI : Hide mouse tooltip
 */
function hideMouseTooltip(): void {
  if (!mouseTooltip) return;
  mouseTooltip.style.opacity = '0';
}

/**
 * AI : Update mouse tooltip position on mouse move
 */
function updateMouseTooltipPosition(event: MouseEvent): void {
  if (!mouseTooltip || mouseTooltip.style.opacity === '0') return;

  mouseTooltip.style.left = event.clientX + 15 + 'px';
  mouseTooltip.style.top = event.clientY - 10 + 'px';
}

/**
 * AI : Render full overlays from cached data
 */
async function renderFullOverlaysFromCache(cityId: string, cityName: string): Promise<void> {
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

    // AI : Set overlays in view mode overlays and render them
    const { setViewModeOverlays } = useViewModeOverlays();
    setViewModeOverlays(overlaysData);

    // AI : Render overlays on the map with markers
    await renderViewModeOverlays(overlaysData, true, true);

    console.log(`AI : Rendered ${overlaysData.length} full overlays for ${cityName} from cache`);
  } catch (error) {
    console.error('AI : Error rendering full overlays from cache:', error);
  }
}

/**
 * AI : Render overlay markers from cached data
 */
function renderOverlayMarkersFromCache(cityId: string, cityName: string): void {
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

    // AI : Create new layer group for overlay markers
    overlayMarkersLayer = L.layerGroup();

    // AI : Add simple markers for each overlay location, color depends on overlay state in edit mode or project status in view mode
    overlaysData.forEach(overlay => {
      // AI : Use getOverlayMarkerInfo which considers edit mode, current overlay state, and position
      const { color: markerColor, position } = getOverlayMarkerInfo(overlay);
      const markerIcon = createColorIcon(markerColor);
      const marker = L.marker([position.lat, position.lng], { icon: markerIcon });

      overlayMarkersLayer!.addLayer(marker);
    });

    // AI : Add overlay markers to map
    if (map.value) {
      overlayMarkersLayer.addTo(map.value);
    }

    console.log(`AI : Rendered ${overlaysData.length} overlay markers for ${cityName} from cache`);
  } catch (error) {
    console.error('AI : Error rendering overlay markers from cache:', error);
  }
}

/**
 * AI : Set up zoom event listener to upgrade overlay markers to full overlays
 */
export function setupZoomEventListener(): void {
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
  if (!map.value) return;

  // AI : Monitor zoom during the zoom process for cleanup only if really needed
  map.value.on('zoom', () => {
    if (!map.value) return;

    const currentZoom = map.value.getZoom();

    // AI : Only hide overlays during zoom if they're causing glitches (very low zoom)
    if (currentZoom < MIN_ZOOM_FOR_OVERLAYS - 2 && currentCityOverlays.value.length > 0) {
      clearAllOverlays();
      currentCityOverlays.value = [];
    }
  });

  map.value.on('zoomend', async () => {
    if (!map.value || !latestClickedCity) return;

    const currentZoom = map.value.getZoom();
    const hasCachedData = cityProjectsCache.has(latestClickedCity.id);

    // AI : Only act if we have cached data to avoid unnecessary API calls
    if (!hasCachedData) return;

    // AI : If zoomed in enough and we have overlay markers, upgrade to full overlays
    if (currentZoom >= MIN_ZOOM_FOR_OVERLAYS && overlayMarkersLayer && map.value.hasLayer(overlayMarkersLayer)) {
      console.log(`AI : Zoom level ${currentZoom} reached. Upgrading to full overlays for ${latestClickedCity.name}`);
      await renderFullOverlaysFromCache(latestClickedCity.id, latestClickedCity.name);
    }
    // AI : If zoomed out from full overlays, show overlay markers again
    else if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && currentCityOverlays.value.length > 0) {
      console.log(`AI : Zoom level ${currentZoom} too low. Clearing overlays and showing overlay markers for ${latestClickedCity.name}`);
      // AI : Clear current overlays first
      clearAllOverlays();
      currentCityOverlays.value = [];
      // AI : Then show overlay markers
      renderOverlayMarkersFromCache(latestClickedCity.id, latestClickedCity.name);
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
    console.log(`AI : Current zoom ${currentZoom} is below threshold. Clearing overlays.`);
    clearAllOverlays();
    currentCityOverlays.value = [];
  }
}

/**
 * AI : Get marker color based on construction start and end dates
 * @param startDate - The construction start date (string or Date or null)
 * @param endDate - The construction end date (string or Date or null)
 * @returns 'blue' | 'grey' | 'orange'
 */
export function getConstructionMarkerColor(startDate: string | Date | null | undefined, endDate: string | Date | null | undefined): 'blue' | 'grey' | 'orange' {
  const now = new Date();
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (start && start > now) {
    return 'orange';
  } else if (start && start <= now && (!end || end > now)) {
    return 'blue';
  } else if (end && end <= now) {
    return 'grey';
  }
  return 'grey';
}

/**
 * AI : Get marker color and position based on overlay state, considering edit mode and current overlay status
 * @param overlayData - The CDN overlay data
 * @returns Object with marker color and position
 */
function getOverlayMarkerInfo(overlayData: CDNOverlayData): { color: 'blue' | 'green' | 'orange' | 'red' | 'gold' | 'yellow' | 'violet' | 'grey' | 'black', position: { lat: number, lng: number } } {
  let position = { lat: overlayData.centroid.lat, lng: overlayData.centroid.lng };
  
  // AI : Check if we're in edit mode and if the overlay exists in the overlays store
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
      
      // AI : Check if this is a replacement overlay first (highest priority)
      if (overlayObject.replacesOverlayId !== null) {
        return { color: 'violet', position };
      }
      
      // AI : Check if overlay was loaded from CDN (has project data from backend)
      const isRemoteOverlay = overlayObject.project !== undefined;
      
      // AI : Check if overlay has been modified locally
      const hasBeenModified = overlayObject.isModified;
      
      if (isRemoteOverlay && !hasBeenModified) {
        // AI : Remote overlay, not modified = green
        return { color: 'green', position };
      } else if (isRemoteOverlay && hasBeenModified) {
        // AI : Remote overlay, modified locally = orange
        return { color: 'orange', position };
      } else if (!isRemoteOverlay && hasBeenModified) {
        // AI : Local overlay with changes = red
        return { color: 'red', position };
      } else {
        // AI : New overlay, no changes = blue
        return { color: 'blue', position };
      }
    } else {
      // AI : Use overlay position from cached data if available (for modified overlays)
      if (overlayData.corners && overlayData.corners.length >= 4) {
        const centerLat = (overlayData.corners[0].lat + overlayData.corners[3].lat) / 2;
        const centerLng = (overlayData.corners[0].lng + overlayData.corners[3].lng) / 2;
        position = { lat: centerLat, lng: centerLng };
      }
      
      // AI : Check if overlay has been modified in cached data
      if (overlayData.isModified) {
        // AI : Modified overlay (from cache) = orange
        return { color: 'orange', position };
      }
    }
  }

  // AI : View mode or overlay not in store/cache - use construction timeline colors
  const color = getConstructionMarkerColor(overlayData.project?.startDate, overlayData.project?.endDate);
  return { color, position };
}

/**
 * AI : Update overlay markers when overlays are modified in edit mode
 * This function should be called when overlays are moved, rotated, or modified
 */
export function updateOverlayMarkers(): void {
  // AI : Only update if we have overlay markers visible and we're in edit mode
  if (!overlayMarkersLayer || !map.value || !map.value.hasLayer(overlayMarkersLayer) || !isEditMode.value) {
    return;
  }

  // AI : Get the current city data from cache
  if (!latestClickedCity || !cityProjectsCache.has(latestClickedCity.id)) {
    return;
  }

  const overlaysData = cityProjectsCache.get(latestClickedCity.id)!;
  
  // AI : Clear existing markers
  overlayMarkersLayer.clearLayers();

  // AI : Re-add markers with updated positions and colors
  overlaysData.forEach(overlay => {
    const { color: markerColor, position } = getOverlayMarkerInfo(overlay);
    const markerIcon = createColorIcon(markerColor);
    const marker = L.marker([position.lat, position.lng], { icon: markerIcon });
    overlayMarkersLayer!.addLayer(marker);
  });

  console.log(`AI : Updated ${overlaysData.length} overlay markers with current state`);
}

/**
 * AI : Apply cached overlay state immediately when an overlay is created during rendering
 * This function should be called from the overlay rendering process
 * @returns true if cached state was applied, false otherwise
 */
export function applyCachedOverlayState(_overlayId: string, _overlayObject: any): boolean {
  // AI : No longer using overlay states cache - overlay data is updated directly in cityProjectsCache
  return false;
}

/**
 * AI : Update cached overlay data when an overlay is modified
 * This ensures there's only one source of truth for overlay data
 */
export function updateCachedOverlayData(overlayId: string, newCorners: { lat: number, lng: number }[]): void {
  if (!latestClickedCity || !cityProjectsCache.has(latestClickedCity.id)) {
    return;
  }

  const overlaysData = cityProjectsCache.get(latestClickedCity.id)!;
  const overlayIndex = overlaysData.findIndex(overlay => overlay.id === overlayId);
  
  if (overlayIndex !== -1) {
    // AI : Update the corners and mark as modified in the cached data
    overlaysData[overlayIndex] = {
      ...overlaysData[overlayIndex],
      corners: [...newCorners],
      isModified: true // AI : Mark as modified so markers show correct color
    };
    
    // AI : Update the cache
    cityProjectsCache.set(latestClickedCity.id, overlaysData);
  }
}