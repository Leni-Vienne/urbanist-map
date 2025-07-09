import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { renderViewModeOverlays, clearAllOverlays, isEditMode } from '@composables/overlay/useOverlay';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import { projects } from '@stores/projectStore';
import { trpc, RouterOutput } from '@client';
import type { CDNOverlayData, StoredProjectData } from '@types';
import { saveProject } from '@composables/core/useDatabase';

// AI : Minimum zoom level required to load city projects and overlays
const MIN_ZOOM_FOR_OVERLAYS = 12;

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
let latestClickedCity: { id: string; name: string } | null = null;

// AI : Track current overlay markers data
let _currentOverlayMarkers: CDNOverlayData[] = [];

// AI : Mouse tooltip element for guidance
let mouseTooltip: HTMLElement | null = null;

// AI : Initialize zoom event listener when map is ready
onMapInitialized(() => {
  setupZoomEventListener();
});

/**
 * AI : Load projects for a specific city and display overlays on map
 */
export async function loadCityProjects(cityId: string, cityName: string, forceFullLoad = false): Promise<void> {
  try {
    // AI : Check if user is zoomed in enough to load full overlays
    if (!map.value) {
      console.warn('AI : Map not available for zoom check');
      return;
    }
    
    const currentZoom = map.value.getZoom();
    
    // AI : Update latest clicked city
    latestClickedCity = { id: cityId, name: cityName };
    
    // AI : If zoom is too low and not forcing full load, show overlay markers only
    if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && !forceFullLoad) {
      console.log(`AI : Zoom level ${currentZoom} too low to load full overlays for ${cityName}. Showing markers only.`);
      await showOverlayMarkers(cityId, cityName);
      return;
    }

    isLoadingCityProjects.value = true;
    
    // AI : Clear any existing overlay markers and overlays before loading new city
    clearAllOverlays();
    removeOverlayMarkers();

    const result = await trpc.cities.getCityProjects.query({ cityId });
    
    // AI : In edit mode, add backend projects to local projects store
    if (isEditMode.value) {
      const updatedProjects = { ...projects.value };
      for (const project of result) {
        const storedProject: StoredProjectData = {
          ...project,
          description: project.description ?? '',
          cityId: project.cityId ?? null,
          startDate: project.startDate ? new Date(project.startDate) : null,
          endDate: project.endDate ? new Date(project.endDate) : null,
          sourceUrl: project.sourceUrl ?? '',
          latestUpdateOn: project.latestUpdateOn ? new Date(project.latestUpdateOn) : null,
          createdAt: project.createdAt ? new Date(project.createdAt) : new Date(),
          updatedAt: project.updatedAt ? new Date(project.updatedAt) : new Date(),
          metadata: project.metadata ?? null,
          savedRemotely: true,
        };
        await saveProject(storedProject);

        updatedProjects[project.id] = {
          ...storedProject,
          name: storedProject.title, // AI : Map title to name for backward compatibility
          // AI : City data not included in simplified response, so omit the field
          overlayIds: project.overlays.map((o) => o.id),
          color: '#007bff', // AI : Default color
        };
      }
      projects.value = updatedProjects;
    } else {
      // AI : In view mode, clear all overlays to show only city overlays
      clearAllOverlays();
    }

    // AI : Convert project overlays to CDN overlay format for rendering
    const overlaysToRender: CDNOverlayData[] = [];
    result.forEach(project => {
      project.overlays.forEach((overlay: any) => {
        overlaysToRender.push({
          id: overlay.id,
          filename: overlay.filename,
          caption: overlay.caption,
          projectId: project.id,
          project: {
            ...project,
            city: null, // AI : City data not included in simplified response
          },
          centroid: {
            lat: (overlay.topLeftLat + overlay.bottomRightLat) / 2,
            lng: (overlay.topLeftLng + overlay.bottomRightLng) / 2
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

    currentCityOverlays.value = overlaysToRender;

    // AI : Get view mode overlays instance to set the overlays
    const { setViewModeOverlays } = useViewModeOverlays();

    // AI : Set overlays in view mode overlays first (for local filtering)
    setViewModeOverlays(overlaysToRender);

    // AI : Render overlays on the map with markers (not disabling them anymore)
    await renderViewModeOverlays(overlaysToRender, true);
    
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
async function showOverlayMarkers(cityId: string, cityName: string): Promise<void> {
  try {
    isLoadingCityProjects.value = true;

    const result = await trpc.cities.getCityProjects.query({ cityId });
    
    // AI : Convert project overlays to CDN overlay format but don't render images
    const overlaysData: CDNOverlayData[] = [];
    result.forEach(project => {
      project.overlays.forEach((overlay: any) => {
        overlaysData.push({
          id: overlay.id,
          filename: overlay.filename,
          caption: overlay.caption,
          projectId: project.id,
          project: {
            ...project,
            city: null,
          },
          centroid: {
            lat: (overlay.topLeftLat + overlay.bottomRightLat) / 2,
            lng: (overlay.topLeftLng + overlay.bottomRightLng) / 2
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

    // AI : Store overlay markers data for later use
    _currentOverlayMarkers = overlaysData;
    
    // AI : Clear existing overlay markers
    removeOverlayMarkers();
    
    // AI : Create new layer group for overlay markers
    overlayMarkersLayer = L.layerGroup();
    
    // AI : Add simple markers for each overlay location
    overlaysData.forEach(overlay => {
      const marker = L.circleMarker([overlay.centroid.lat, overlay.centroid.lng], {
        radius: 8,
        fillColor: '#ff6b35',
        fillOpacity: 0.8,
        color: '#ffffff',
        weight: 2,
        opacity: 1
      });

      // AI : Add tooltip with project info
      marker.bindTooltip(`📷 ${overlay.project?.title || 'Project'}${overlay.caption ? `<br/>${overlay.caption}` : ''}`, {
        permanent: false,
        direction: 'top'
      });

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
  _currentOverlayMarkers = [];
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

  // AI : Remove existing city markers if any
  if (cityMarkersLayer) {
    map.value.removeLayer(cityMarkersLayer);
  }

  // AI : Create new layer group for city markers
  cityMarkersLayer = L.layerGroup();  // AI : Add markers for each city with projects
  cities.forEach(city => {
    // AI : Create a standard Leaflet marker
    const marker = L.marker([city.lat, city.lng]);

    // AI : Add tooltip with city name
    marker.bindTooltip(`${city.name}`, {
      permanent: true,
    });

    // AI : Add click event to load city projects directly
    marker.on('click', async () => {
      await loadCityProjects(city.id, city.name);
    });

    // AI : Add mouseover event to show guidance tooltip
    marker.on('mouseover', (event) => {
      createMouseTooltip();
      showMouseTooltip(event.originalEvent);
    });

    // AI : Add mousemove event to update tooltip position
    marker.on('mousemove', (event) => {
      updateMouseTooltipPosition(event.originalEvent);
    });

    // AI : Add mouseout event to hide guidance tooltip
    marker.on('mouseout', () => {
      hideMouseTooltip();
    });

    cityMarkersLayer!.addLayer(marker);
  });

  // AI : Add the layer group to the map
  cityMarkersLayer.addTo(map.value);
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
 * AI : Cleanup city markers system
 */
export function cleanupCityMarkers(): void {
  removeCityMarkers();
  removeOverlayMarkers();
  cleanupMouseTooltip();
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
    
    // AI : If zoomed in enough and we have overlay markers, upgrade to full overlays
    if (currentZoom >= MIN_ZOOM_FOR_OVERLAYS && overlayMarkersLayer && map.value.hasLayer(overlayMarkersLayer)) {
      console.log(`AI : Zoom level ${currentZoom} reached. Upgrading to full overlays for ${latestClickedCity.name}`);
      // AI : Remove circle markers before loading full overlays
      removeOverlayMarkers();
      await loadCityProjects(latestClickedCity.id, latestClickedCity.name, true);
    }
    // AI : If zoomed out from full overlays, show circle markers again
    else if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && currentCityOverlays.value.length > 0) {
      console.log(`AI : Zoom level ${currentZoom} too low. Showing overlay markers for ${latestClickedCity.name}`);
      clearAllOverlays();
      currentCityOverlays.value = [];
      await showOverlayMarkers(latestClickedCity.id, latestClickedCity.name);
    }
  });
}

// AI : Initialize zoom event listener when map is ready
onMapInitialized(() => {
  setupZoomEventListener();
});

/**
 * AI : Force cleanup of all overlays and markers regardless of zoom level
 */
export function forceCleanupOverlays(): void {
  try {
    // AI : Clear all overlays
    clearAllOverlays();
    currentCityOverlays.value = [];
    
    // AI : Remove overlay markers
    removeOverlayMarkers();
    
    // AI : Clear view mode overlays
    const { setViewModeOverlays } = useViewModeOverlays();
    setViewModeOverlays([]);
    
    console.log('AI : Force cleanup completed - all overlays and markers removed');
  } catch (error) {
    console.error('AI : Error during force cleanup:', error);
  }
}

/**
 * AI : Check current zoom and hide overlays if needed
 */
export function checkZoomAndHideOverlays(): void {
  if (!map.value) return;
  
  const currentZoom = map.value.getZoom();
  
  if (currentZoom < MIN_ZOOM_FOR_OVERLAYS) {
    console.log(`AI : Current zoom ${currentZoom} is below threshold. Force cleaning overlays.`);
    forceCleanupOverlays();
  }
}
