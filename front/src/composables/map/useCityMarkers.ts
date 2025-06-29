import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { renderViewModeOverlays, clearAllOverlays } from '@composables/overlay/useOverlay';
import { useViewModeOverlays } from '@composables/overlay/useViewModeOverlays';
import { trpc } from '@client';
import type { CDNOverlayData } from '@types';

// AI : Type for city with projects
export interface CityWithProjects {
  id: string;
  name: string;
  countryCode: string;
  lat: number;
  lng: number;
  projectCount: number;
}

// AI : Type for city project data
export interface CityProject {
  id: string;
  title: string;
  description?: string;
  metadata?: any;
  createdAt: Date;
  overlays: Array<{
    id: string;
    filename: string;
    caption?: string;
    metadata?: any;
    corners: {
      topLeft: { lat: number; lng: number };
      topRight: { lat: number; lng: number };
      bottomRight: { lat: number; lng: number };
      bottomLeft: { lat: number; lng: number };
    };
    createdAt: Date;
  }>;
}

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
 * AI : Load cities with projects from the backend
 */
export async function loadCitiesWithProjects(): Promise<void> {
  try {
    isLoadingCities.value = true;

    const result = await trpc.cities.getCitiesWithProjects.query();
    citiesWithProjects.value = result;
  } catch (error) {
    console.error('AI : Error loading cities with projects:', error);
  } finally {
    isLoadingCities.value = false;
  }
}

/**
 * AI : Load projects for a specific city and display overlays on map
 */
export async function loadCityProjects(cityId: string, _cityName: string): Promise<void> {
  try {
    isLoadingCityProjects.value = true;

    const result = await trpc.cities.getCityProjects.query({ cityId });

    // AI : Clear existing overlays
    clearAllOverlays();

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
            id: project.id,
            title: project.title,
            description: project.description,
            cityId: project.cityId,
            city: project.city,
            metadata: project.metadata,
            createdAt: project.createdAt,
            updatedAt: project.createdAt || null
          },
          centroid: {
            lat: (overlay.corners.topLeft.lat + overlay.corners.bottomRight.lat) / 2,
            lng: (overlay.corners.topLeft.lng + overlay.corners.bottomRight.lng) / 2
          },
          corners: [
            overlay.corners.topLeft,
            overlay.corners.topRight,
            overlay.corners.bottomRight,
            overlay.corners.bottomLeft
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
 * AI : Add city markers to the map
 */
export function addCityMarkersToMap(): void {
  if (!map.value) {
    // AI : If map is not ready, wait for initialization
    onMapInitialized(() => {
      addCityMarkersToMapInternal();
    });
    return;
  }

  addCityMarkersToMapInternal();
}

/**
 * AI : Internal function to add city markers to map
 */
function addCityMarkersToMapInternal(): void {
  if (!map.value) {
    return;
  }

  // AI : Remove existing city markers if any
  if (cityMarkersLayer) {
    map.value.removeLayer(cityMarkersLayer);
  }

  // AI : Create new layer group for city markers
  cityMarkersLayer = L.layerGroup();  // AI : Add markers for each city with projects
  citiesWithProjects.value.forEach(city => {
    // AI : Create a standard Leaflet marker
    const marker = L.marker([city.lat, city.lng]);

    // AI : Add tooltip with city name
    marker.bindTooltip(`${city.name} (${city.projectCount} projet${city.projectCount > 1 ? 's' : ''})`, {
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
 * AI : Clean up mouse tooltip element
 */
function cleanupMouseTooltip(): void {
  if (mouseTooltip) {
    document.body.removeChild(mouseTooltip);
    mouseTooltip = null;
  }
}

/**
 * AI : Initialize city markers system
 */
export async function initializeCityMarkers(): Promise<void> {
  await loadCitiesWithProjects();
  addCityMarkersToMap();
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
