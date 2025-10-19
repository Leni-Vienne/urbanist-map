import L from "leaflet";
import { createDevelopmentIcon, createColorIcon } from '@composables/ui/markerIcons';
import type { MarkerColor, Project } from '@types';
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { mobileAwareFlyTo } from '@composables/map/useMobileAwareFly';
import { loadCityOverlays } from '@composables/map/useCityOverlays';
import { useSelectedProject } from '@composables/project/useSelectedProject';
import { RouterOutput, trpc } from '@client';

import { useUiStore } from '@stores/uiStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjects } from '@composables/project/useProjects';
import { createProject } from '../../utils/typeFactories';

// AI : Get project marker color based on status and timeline
function getProjectMarkerColor(project: Project): MarkerColor {
  // AI : Pending projects always show as yellow (proposed/awaiting approval)
  if (project.status === 'pending') {
    return 'yellow'; // Pending approval
  }

  // AI : Timeline-based colors for approved/rejected projects
  const { proposalDate, startDate, endDate } = project;

  // AI : If only proposalDate is set (no start date), it's just a proposal
  if (proposalDate && !startDate) return 'yellow'; // Proposed but not started (nor planned)

  // AI : If no start date but has other dates, consider it not yet scheduled
  if (!startDate) return 'yellow'; // Not yet scheduled

  const now = new Date();
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;

  if (start > now) return 'green'; // Upcoming
  if (end && end <= now) return 'grey'; // Completed
  return 'orange'; // Ongoing
}


// AI : Opacity constants for city markers
const MARKER_OPACITY = 0.6; // AI : Default opacity for city markers
const BUILDING_MARKER_OPACITY = 0.8; // AI : Default opacity for development markers
const MARKER_HOVER_OPACITY = 1; // AI : Opacity for city markers on hover

// AI : Utility function to reset all markers in a layer group to default opacity
export function resetLayerMarkersOpacity(layerGroup: L.LayerGroup | null, defaultOpacity: number) {
  if (!layerGroup) return;

  layerGroup.eachLayer((layer) => {
    if (layer instanceof L.Marker) {
      layer.setOpacity(defaultOpacity);
    }
  });
}

// AI : Update development marker opacities based on selected marker
export function updateDevelopmentMarkerOpacities(selectedMarker: L.Marker | null) {
  if (!developmentProjectsLayer) return;

  selectedDevelopmentMarker = selectedMarker;

  developmentProjectsLayer.eachLayer((layer) => {
    if (layer instanceof L.Marker) {
      if (selectedMarker && layer === selectedMarker) {
        layer.setOpacity(1); // AI : Fully opaque for selected marker
      } else {
        layer.setOpacity(BUILDING_MARKER_OPACITY); // AI : Default opacity for others
      }
    }
  });
}

// AI : Type aliases using RouterOutput from tRPC
export type CityWithProjects = RouterOutput['cities']['getCitiesWithProjects'][number];

// AI : Cities with projects data
export const citiesWithProjects = ref<CityWithProjects[]>([]);

// AI : Layer group for city markers
let cityMarkersLayer: L.LayerGroup | null = null;

// AI : Layer group for development projects (development markers)
let developmentProjectsLayer: L.LayerGroup | null = null;

// AI : Track the currently selected (clicked) city marker
let selectedCityMarker: L.Marker | null = null;

// AI : Track the currently selected development marker (for opacity control)
let selectedDevelopmentMarker: L.Marker | null = null;

// AI : Store the current marker for position tracking
let currentMarkerForPopup: L.Marker | L.CircleMarker | null = null;
let mapClickHandler: (() => void) | null = null;

/**
 * AI : Update teleport target position based on current marker
 */
function updateTeleportTargetPosition() {
  if (!currentMarkerForPopup || !map.value) return;

  const teleportTarget = document.querySelector('#project-info-popup-teleport-target') as HTMLElement;
  if (!teleportTarget) return;

  // AI : Get updated marker position in screen coordinates
  const markerLatLng = currentMarkerForPopup.getLatLng();
  const markerPoint = map.value.latLngToContainerPoint(markerLatLng);

  // AI : Update position
  teleportTarget.style.left = `${markerPoint.x}px`;
  teleportTarget.style.top = `${markerPoint.y}px`;
}

/**
 * AI : Create teleport target for project info popup at marker position
 */
function createProjectInfoTeleportTarget(marker: L.Marker | L.CircleMarker) {
  if (!map.value) return;

  // AI : Remove any existing teleport target and event listeners
  cleanupProjectInfoTeleportTarget();

  // AI : Store marker reference for position tracking
  currentMarkerForPopup = marker;

  // AI : Get marker position in screen coordinates
  const markerLatLng = marker.getLatLng();
  const markerPoint = map.value.latLngToContainerPoint(markerLatLng);

  // AI : Create teleport target div
  const teleportTarget = document.createElement('div');
  teleportTarget.id = 'project-info-popup-teleport-target';

  // AI : Position it at the marker location
  teleportTarget.style.cssText = `
    pointer-events: none; 
    position: absolute; 
    left: ${markerPoint.x}px; 
    top: ${markerPoint.y}px; 
    width: 0; 
    height: 0; 
    overflow: visible;
  `;

  // AI : Add to map container
  const mapContainer = map.value.getContainer();
  mapContainer.appendChild(teleportTarget);

  // AI : Set up event listeners to update position when map moves
  map.value.on('move', updateTeleportTargetPosition);
  map.value.on('zoom', updateTeleportTargetPosition);
  map.value.on('resize', updateTeleportTargetPosition);

  // AI : Add map click handler to close project popup
  mapClickHandler = () => {
    const uiStore = useUiStore();
    if (uiStore.projectInfoPopup.visible) {
      uiStore.closeProjectInfoPopup();
    }
  };
  map.value.on('click', mapClickHandler);
}

/**
 * AI : Clean up teleport target and event listeners
 */
export function cleanupProjectInfoTeleportTarget() {
  // AI : Remove event listeners if map exists
  if (map.value) {
    map.value.off('move', updateTeleportTargetPosition);
    map.value.off('zoom', updateTeleportTargetPosition);
    map.value.off('resize', updateTeleportTargetPosition);

    // AI : Remove map click handler
    if (mapClickHandler) {
      map.value.off('click', mapClickHandler);
      mapClickHandler = null;
    }
  }

  // AI : Remove teleport target
  const existingTarget = document.querySelector('#project-info-popup-teleport-target');
  if (existingTarget) {
    existingTarget.remove();
  }

  // AI : Clear marker reference
  currentMarkerForPopup = null;

  // AI : Reset development marker opacities when popup closes
  updateDevelopmentMarkerOpacities(null);
}

/**
 * AI : Load development projects for a specific city and display them on map
 */
export async function loadCityDevelopmentProjects(cityId: string | null): Promise<void> {
  if (!map.value) return;

  try {
    const mapStore = useMapStore();
    const overlayStore = useOverlayStore();
    
    // AI : Check cache first for non-null cityId
    let backendDevelopmentProjects: RouterOutput['project']['getCityProjects'] = [];
    if (cityId) {
      const cachedData = mapStore.getCityDevelopmentProjectsCache(cityId);
      if (cachedData) {
        backendDevelopmentProjects = cachedData;
      } else {
        // AI : Get development projects for this city from backend
        // AI : viewMode is opposite of isEditMode - in edit mode (false), we want to see user's own pending content
        backendDevelopmentProjects = await trpc.project.getCityProjects.query({ cityId, viewMode: !overlayStore.isEditMode });
        // AI : Cache the result
        mapStore.setCityDevelopmentProjectsCache(cityId, backendDevelopmentProjects);
      }
    }
    
    const backendDevelopmentProjectsOnly = backendDevelopmentProjects.filter(project => project.isDevelopment);

    // AI : Get local development projects for this city (handle null cityId case)
    const { projects: localProjects } = useProjects();
    const allLocalProjects = Object.values(localProjects.value);

    const localDevelopmentProjects = allLocalProjects
      .filter(project => project.isDevelopment && (project.cityId === cityId || (cityId === null && (project.cityId === null || project.cityId === undefined))));

    // AI : Combine backend and local projects, avoiding duplicates
    const allDevelopmentProjects = [
      ...backendDevelopmentProjectsOnly,
      ...localDevelopmentProjects.filter(local =>
        !backendDevelopmentProjectsOnly.some(backend => backend.id === local.id)
      )
    ];

    // AI : Remove existing development projects layer
    if (developmentProjectsLayer) {
      map.value.removeLayer(developmentProjectsLayer);
    }
    developmentProjectsLayer = L.layerGroup();

    allDevelopmentProjects.forEach(project => {
      if (project.lat && project.lng) {
        // AI : Get marker color based on edit mode and status
        const projectData = 'overlayIds' in project ? project : createProject({
          ...project,
          city: {
            ...project.city,
            coordinates: { x: project.city.coordinates.x, y: project.city.coordinates.y },
            createdAt: new Date(),
            updatedAt: new Date()
          },
          savedRemotely: true,
          status: ('status' in project ? project.status : 'approved') as 'pending' | 'approved' | 'rejected'
        });
        const markerColor = getProjectMarkerColor(projectData);
        const markerIcon = createDevelopmentIcon(markerColor);

        // AI : Create marker with timeline-based color icon and default opacity
        const marker = L.marker([project.lat, project.lng], {
          icon: markerIcon,
          opacity: BUILDING_MARKER_OPACITY // AI : Lower default opacity to suggest interactivity
        });

        // AI : Prevent double-click zoom on markers
        marker.on('dblclick', (e) => {
          L.DomEvent.stopPropagation(e);
        });

        // AI : Add mouseover event to increase marker opacity
        marker.on('mouseover', () => {
          marker.setOpacity(MARKER_HOVER_OPACITY);
        });

        // AI : Add mouseout event to reset marker opacity (unless it's the selected marker)
        marker.on('mouseout', () => {
          // AI : If this is the selected marker, keep it fully opaque
          if (selectedDevelopmentMarker === marker) {
            marker.setOpacity(1);
          } else {
            marker.setOpacity(BUILDING_MARKER_OPACITY);
          }
        });

        // AI : Add click handler for development project - show info popup first
        marker.on('click', (e) => {
          // AI : Stop all event propagation using Leaflet's method
          L.DomEvent.stopPropagation(e);

          const uiStore = useUiStore();

          // AI : Check if popup is already open for this project - toggle behavior
          if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
            // AI : Close the popup if it's already open for this project
            uiStore.closeProjectInfoPopup();
            // AI : Reset all marker opacities
            updateDevelopmentMarkerOpacities(null);
            return;
          }

          // AI : Create teleport target at marker position
          createProjectInfoTeleportTarget(marker);

          // AI : Update marker opacities (make this one fully opaque)
          updateDevelopmentMarkerOpacities(marker);

          // AI : Use uiStore to show project info popup, convert backend projects to local format
          const projectData = 'overlayIds' in project ? project : createProject({
            ...project,
            city: project.city,
            savedRemotely: true,
            status: 'approved'
          });
          uiStore.openProjectInfoPopup(project.id, projectData);
        });

        marker.addTo(developmentProjectsLayer!);
      }
    });

    // AI : Add layer to map
    developmentProjectsLayer.addTo(map.value);
  } catch (error) {
    console.error('Error loading development projects:', error);
  }
}

/**
 * AI : Load projects for a specific city and display overlays on map
 */
export async function loadCityProjects(cityId: string | null, cityName: string, forceFullLoad = false, cityCountryCode?: string): Promise<void> {
  try {
    // AI : Update selected city in store (only if cityId is not null)
    if (cityId) {
      const mapStore = useMapStore();
      const uiStore = useUiStore();

      mapStore.setSelectedCity({ id: cityId, name: cityName, countryCode: cityCountryCode });

      // AI : Clear selected project when switching cities
      const { selectedProjectId } = useSelectedProject();
      selectedProjectId.value = null;

      // AI : Close project info popup when switching cities
      uiStore.closeProjectInfoPopup();

      // AI : Load both overlay projects and development projects
      await Promise.all([
        loadCityOverlays(cityId, forceFullLoad),
        loadCityDevelopmentProjects(cityId)
      ]);
    } else {
      // AI : Just load local development projects when no city is selected
      await loadCityDevelopmentProjects(null);
    }
  } catch (error) {
    console.error('Error loading city projects:', error);
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

  // AI : Also remove development projects layer
  if (developmentProjectsLayer && map.value?.hasLayer(developmentProjectsLayer)) {
    map.value.removeLayer(developmentProjectsLayer);
    developmentProjectsLayer = null;
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
      opacity: MARKER_OPACITY // AI : Lower default opacity to suggest interactivity
    });

    // AI : Add data-testid to the marker element after it's added to the DOM
    marker.on('add', () => {
      const markerElement = marker.getElement();
      if (markerElement) {
        markerElement.setAttribute('data-testid', `city-marker-${city.id}`);
        markerElement.setAttribute('data-city-id', city.id);
        markerElement.setAttribute('data-city-name', city.name);
        markerElement.setAttribute('data-country-code', city.countryCode);
        markerElement.setAttribute('data-lat', city.lat.toString());
        markerElement.setAttribute('data-lng', city.lng.toString());
      }
    });

    // AI : Add tooltip with city name, only on hover
    marker.bindTooltip(city.name, {
      permanent: false, // AI : Tooltip appears only on hover
    });

    // AI : Add click event to load city projects directly and set marker as selected
    marker.on('click', async () => {
      resetLayerMarkersOpacity(cityMarkersLayer, MARKER_OPACITY);
      marker.setOpacity(MARKER_HOVER_OPACITY);
      selectedCityMarker = marker;
      
      // AI : Zoom to the city marker position (same zoom level as MarkerHelpButton)
      if (map.value && map.value.getZoom() <= 9) {
        mobileAwareFlyTo([city.lat, city.lng], 12, {
          duration: 1.5
        });
      }
      
      await loadCityProjects(city.id, city.name, false, city.countryCode);
    });

    // AI : Add mouseover event to show guidance tooltip and increase marker opacity
    marker.on('mouseover', () => {
      // AI : Only increase opacity if not selected
      if (selectedCityMarker !== marker) {
        marker.setOpacity(MARKER_HOVER_OPACITY);
      }
    });

    // AI : Add mouseout event to hide guidance tooltip and reset marker opacity if not selected
    marker.on('mouseout', () => {
      // AI : Only reset opacity if not selected
      if (selectedCityMarker !== marker) {
        marker.setOpacity(MARKER_OPACITY);
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