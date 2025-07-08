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

// AI : Mouse tooltip element for guidance
let mouseTooltip: HTMLElement | null = null;

/**
 * AI : Show message to user when zoom level is too low for loading overlays
 */
function showZoomMessage(): void {
  // AI : Create temporary tooltip to inform user about zoom requirement
  const zoomTooltip = document.createElement('div');
  zoomTooltip.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10001;
    text-align: center;
    max-width: 280px;
    width: calc(100vw - 40px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideInDown 0.3s ease-out;
  `;
  
  // AI : Add animation keyframes for smooth appearance
  if (!document.querySelector('#zoom-message-styles')) {
    const style = document.createElement('style');
    style.id = 'zoom-message-styles';
    style.textContent = `
      @keyframes slideInDown {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  zoomTooltip.innerHTML = `
    <div style="font-size: 13px;">Zoom in closer to view construction projects</div>
    <div style="font-size: 12px; margin-top: 4px; opacity: 0.8;">Minimum zoom level: ${MIN_ZOOM_FOR_OVERLAYS}</div>
  `;
  
  document.body.appendChild(zoomTooltip);
  
  // AI : Auto-remove message after 3 seconds
  setTimeout(() => {
    if (document.body.contains(zoomTooltip)) {
      document.body.removeChild(zoomTooltip);
    }
  }, 3000);
}

/**
 * AI : Load projects for a specific city and display overlays on map
 */
export async function loadCityProjects(cityId: string, cityName: string): Promise<void> {
  try {
    // AI : Check if user is zoomed in enough to load overlays
    if (!map.value) {
      console.warn('AI : Map not available for zoom check');
      return;
    }
    
    const currentZoom = map.value.getZoom();
    if (currentZoom < MIN_ZOOM_FOR_OVERLAYS) {
      console.log(`AI : Zoom level ${currentZoom} too low to load overlays for ${cityName}. Minimum required: ${MIN_ZOOM_FOR_OVERLAYS}`);
      // AI : Show user-friendly message instead of loading overlays
      showZoomMessage();
      return;
    }

    isLoadingCityProjects.value = true;

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

    // AI : Render overlays on the map
    await renderViewModeOverlays(overlaysToRender);
  } catch (error) {
    console.error('AI : Error loading city projects:', error);
    currentCityOverlays.value = [];
  } finally {
    isLoadingCityProjects.value = false;
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
    marker.bindTooltip(`${city.name} (${city.projectCount} project${city.projectCount > 1 ? 's' : ''})`, {
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
  cleanupMouseTooltip();
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
