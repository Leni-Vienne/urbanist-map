import L from "leaflet";
import { createColorIcon } from '@composables/ui/colorMarkers';
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

// AI : Mouse tooltip element for guidance
let mouseTooltip: HTMLElement | null = null;

// AI : Track the currently selected (clicked) city marker
let selectedCityMarker: L.Marker | null = null;

// AI : Initialize zoom event listener when map is ready
onMapInitialized(() => {
  setupZoomEventListener();
});

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

    // AI : If zoom is too low and not forcing full load, show overlay markers only
    if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && !forceFullLoad) {
      console.log(`AI : Zoom level ${currentZoom} too low to load full overlays for ${cityName}. Showing markers only.`);
      await showOverlayMarkers(cityId, cityName, cityCountryCode);
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
          // AI : Extract overlay IDs from the JSON array returned by backend
          overlayIds: (project.overlays as any[])?.map((o: any) => o.id) ?? [],
          color: '#007bff', // AI : Default color
          city: cityCountryCode ? {
            id: cityId,
            name: cityName,
            countryCode: cityCountryCode,
            coordinates: { x: 0, y: 0 }, // AI : Placeholder coordinates
            createdAt: new Date(),
            updatedAt: new Date(),
          } : undefined, // AI : Add city information to local projects
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

        overlaysToRender.push({
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
            lat: overlay.centroidLat,
            lng: overlay.centroidLng
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
async function showOverlayMarkers(cityId: string, cityName: string, cityCountryCode?: string): Promise<void> {
  try {
    isLoadingCityProjects.value = true;

    const result = await trpc.cities.getCityProjects.query({ cityId });

    // AI : Convert project overlays to CDN overlay format but don't render images
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
          console.warn('AI : Skipping overlay marker with invalid coordinates:', overlay.id);
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

    // AI : Clear existing overlay markers
    removeOverlayMarkers();

    // AI : Create new layer group for overlay markers
    overlayMarkersLayer = L.layerGroup();

    // AI : Add simple markers for each overlay location, color depends on project status using colorMarkers.ts
    overlaysData.forEach(overlay => {
      // AI : Use getConstructionMarkerColor for marker color
      const markerColor = getConstructionMarkerColor(overlay.project?.startDate, overlay.project?.endDate);
      const markerIcon = createColorIcon(markerColor);
      const marker = L.marker([overlay.centroid.lat, overlay.centroid.lng], { icon: markerIcon });

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
    cityMarkersLayer.addTo(map.value!);
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
      // AI : Remove overlay markers before loading full overlays
      removeOverlayMarkers();
      await loadCityProjects(latestClickedCity.id, latestClickedCity.name, true);
    }
    // AI : If zoomed out from full overlays, show overlay markers again
    else if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && currentCityOverlays.value.length > 0) {
      console.log(`AI : Zoom level ${currentZoom} too low. Clearing overlays and showing overlay markers for ${latestClickedCity.name}`);
      // AI : Force cleanup all overlays first
      forceCleanupOverlays();
      // AI : Then show overlay markers
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