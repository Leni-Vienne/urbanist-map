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

/**
 * AI : Load cities with projects from the backend
 */
export async function loadCitiesWithProjects(): Promise<void> {
  try {
    isLoadingCities.value = true;
    console.log('AI : Loading cities with projects...');

    const result = await trpc.cities.getCitiesWithProjects.query();
    citiesWithProjects.value = result;

    console.log('AI : Loaded cities with projects:', result.length);
  } catch (error) {
    console.error('AI : Error loading cities with projects:', error);
  } finally {
    isLoadingCities.value = false;
  }
}

/**
 * AI : Load projects for a specific city and display overlays on map
 */
export async function loadCityProjects(cityId: string, cityName: string): Promise<void> {
  try {
    isLoadingCityProjects.value = true;
    console.log('AI : Loading projects for city:', cityId);

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
            metadata: project.metadata,
            createdAt: project.createdAt,
            updatedAt: project.createdAt // AI : Use createdAt as fallback
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

    console.log('AI : Displayed', overlaysToRender.length, 'overlays for city:', cityName);
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
  console.log('AI : addCityMarkersToMap called, map.value:', !!map.value);

  if (!map.value) {
    // AI : If map is not ready, wait for initialization
    console.log('AI : Map not ready, waiting for initialization');
    onMapInitialized(() => {
      console.log('AI : Map initialized, adding city markers');
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
    console.log('AI : Map still not available in addCityMarkersToMapInternal');
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

    cityMarkersLayer!.addLayer(marker);
  });

  // AI : Add the layer group to the map
  cityMarkersLayer.addTo(map.value);
  console.log('AI : City markers added successfully');
}

/**
 * AI : Remove city markers from the map
 */
export function removeCityMarkers(): void {
  if (map.value && cityMarkersLayer) {
    map.value.removeLayer(cityMarkersLayer);
    cityMarkersLayer = null;
    console.log('AI : City markers removed');
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
 * AI : Initialize city markers system
 */
export async function initializeCityMarkers(): Promise<void> {
  await loadCitiesWithProjects();
  addCityMarkersToMap();
}
