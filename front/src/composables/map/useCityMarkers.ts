import L from "leaflet";
import { createBasicProjectIcon } from '@composables/map/useMarkers';
import type { MarkerColor, Project } from '@types';
import { ref, watch } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { mobileAwareFlyTo } from '@composables/map/useMapNavigation';
import { loadCityOverlays } from '@composables/map/useCityOverlays';
import { useSelectedProject } from '@composables/project/useProjectSelection';
import { RouterOutput, trpc } from '@client';

import { useUiStore } from '@stores/uiStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useProjects } from '@composables/project/useProjects';
import { createProject } from '../../utils/typeFactories';
import { MARKER_OPACITY } from '@constants/markerConstants';
import { createMarkerLayer, type MarkerLayerConfig } from '@composables/map/useMarkerLayer';

// AI : Get project marker color based on status, timeline, and mode
function getProjectMarkerColor(project: Project, mode: 'view' | 'edit' | 'moderation'): MarkerColor {
  if (mode === 'moderation') {
    // AI : Moderation mode color logic - objective view for review (same as overlays)
    const status = project.status;

    // AI : Pending brand new projects
    if (status === 'pending') return 'yellow';

    // AI : Approved projects
    if (status === 'approved') return 'green';

    // AI : Rejected projects (shouldn't appear in moderation but just in case)
    return 'grey';
  }

  if (mode === 'edit') {
    // AI : Edit mode uses approval status colors like overlay markers
    const hasBeenModified = project.isModified ?? false;
    const status = project.status;

    // AI : Priority 1: Local modifications (shows user they have unsaved work)
    if (hasBeenModified) return 'orange';

    // AI : Priority 2: Pending approval (awaiting moderation)
    if (status === 'pending') return 'yellow';

    // AI : Priority 3: Rejected projects
    if (status === 'rejected') return 'red';

    // AI : Priority 4: Approved and unmodified
    if (status === 'approved') return 'green';

    // AI : Default: New project not yet submitted (no status)
    return 'red';
  }

  // AI : View mode uses timeline-based colors
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


// AI : Opacity constants are now imported from markerConstants

// AI : Update development marker opacities based on selected marker
export function updateDevelopmentMarkerOpacities(selectedMarker: L.Marker | null) {
  if (!developmentProjectsLayer) return;

  // AI : If there was a previously selected marker and we're changing selection, force reset its opacity
  if (selectedDevelopmentMarker && selectedDevelopmentMarker !== selectedMarker) {
    selectedDevelopmentMarker.setOpacity(MARKER_OPACITY.development.default);
  }

  selectedDevelopmentMarker = selectedMarker;

  developmentProjectsLayer.eachLayer((layer) => {
    if (layer instanceof L.Marker) {
      if (selectedMarker && layer === selectedMarker) {
        layer.setOpacity(MARKER_OPACITY.development.hover); // AI : Fully opaque for selected marker
      } else {
        layer.setOpacity(MARKER_OPACITY.development.default); // AI : Default opacity for others
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

// AI : Map to store city ID to marker references for easy lookup
const cityMarkerMap = new Map<string, L.Marker>();

// AI : Layer group for development projects (development markers)
let developmentProjectsLayer: L.LayerGroup | null = null;

// AI : Track the currently selected development marker (for opacity control)
let selectedDevelopmentMarker: L.Marker | null = null;

// AI : Store the current marker for position tracking
let currentMarkerForPopup: L.Marker | L.CircleMarker | null = null;
let mapClickHandler: (() => void) | null = null;

// AI : Map to store project ID to marker references for easy lookup
const developmentMarkerMap = new Map<string, L.Marker>();

// AI : Flag to ensure watcher is only set up once
let modeWatcherInitialized = false;

/**
 * AI : Initialize mode change watcher (called lazily on first use)
 * This handles both switchMode() and direct setMode() calls (like from side menu)
 */
function initializeModeWatcher() {
  if (modeWatcherInitialized) return;

  const overlayStore = useOverlayStore();
  watch(() => overlayStore.mode, () => {
    updateAllDevelopmentMarkerColors();
  });

  modeWatcherInitialized = true;
}

// AI : Flag to ensure city marker watcher is only set up once
let cityMarkerWatcherInitialized = false;

/**
 * AI : Initialize selectedCity watcher to update city marker opacity
 * This makes the selected city marker opaque when navigating from panels
 */
function initializeCityMarkerWatcher() {
  if (cityMarkerWatcherInitialized) return;

  const mapStore = useMapStore();
  watch(() => mapStore.selectedCity, (selectedCity) => {
    updateCityMarkerOpacities(selectedCity?.id ?? null);
  });

  cityMarkerWatcherInitialized = true;
}

/**
 * AI : Update city marker opacities based on selected city
 */
export function updateCityMarkerOpacities(selectedCityId: string | null): void {
  if (!cityMarkersLayer) return;

  cityMarkersLayer.eachLayer((layer) => {
    if (layer instanceof L.Marker) {
      const markerElement = layer.getElement();
      const cityId = markerElement?.getAttribute('data-city-id');

      if (selectedCityId && cityId === selectedCityId) {
        layer.setOpacity(MARKER_OPACITY.city.hover);
      } else {
        layer.setOpacity(MARKER_OPACITY.city.default);
      }
    }
  });
}

/**
 * AI : Get development marker by project ID
 */
export function getDevelopmentMarkerByProjectId(projectId: string): L.Marker | undefined {
  return developmentMarkerMap.get(projectId);
}

/**
 * AI : Add development marker for a specific project
 * This is called when the last overlay is deleted from a project
 */
export function addDevelopmentMarkerForProject(project: Project): void {
  if (!map.value || !project.lat || !project.lng) return;

  // AI : Don't add if marker already exists
  if (developmentMarkerMap.has(project.id)) return;

  // AI : Ensure development layer exists
  if (!developmentProjectsLayer) {
    developmentProjectsLayer = L.layerGroup();
    developmentProjectsLayer.addTo(map.value);
  }

  const overlayStore = useOverlayStore();
  const markerColor = getProjectMarkerColor(project, overlayStore.mode);
  const markerIcon = createBasicProjectIcon(markerColor);

  // AI : Create marker with default opacity
  const marker = L.marker([project.lat, project.lng], {
    icon: markerIcon,
    opacity: MARKER_OPACITY.development.default
  });

  // AI : Prevent double-click zoom on markers
  marker.on('dblclick', (e) => {
    L.DomEvent.stopPropagation(e);
  });

  // AI : Add mouseover event to increase marker opacity
  marker.on('mouseover', () => {
    marker.setOpacity(MARKER_OPACITY.development.hover);
  });

  // AI : Add mouseout event to reset marker opacity (unless it's the selected marker)
  marker.on('mouseout', () => {
    if (selectedDevelopmentMarker === marker) {
      marker.setOpacity(MARKER_OPACITY.development.hover);
    } else {
      marker.setOpacity(MARKER_OPACITY.development.default);
    }
  });

  // AI : Add click handler for projects without overlays - show info popup
  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    const uiStore = useUiStore();

    // AI : Check if popup is already open for this project - toggle behavior
    if (uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === project.id) {
      uiStore.closeProjectInfoPopup();
      updateDevelopmentMarkerOpacities(null);
      return;
    }

    // AI : Create teleport target at marker position
    createProjectInfoTeleportTarget(marker);

    // AI : Update marker opacities (make this one fully opaque)
    updateDevelopmentMarkerOpacities(marker);

    // AI : Use uiStore to show project info popup
    // AI : Close overlay popup if it's open (only one popup at a time)
    if (overlayStore.showInfoPopup) {
      overlayStore.hideInfoPopup();
    }
    uiStore.openProjectInfoPopup(project.id, project);
  });

  // AI : Store marker in map for easy lookup
  developmentMarkerMap.set(project.id, marker);

  // AI : Add marker to layer
  marker.addTo(developmentProjectsLayer);
}

/**
 * AI : Remove development marker for a specific project
 * This is called when the first overlay is added to a development project
 */
export function removeDevelopmentMarkerForProject(projectId: string): void {
  const marker = developmentMarkerMap.get(projectId);
  if (!marker) return;

  // AI : Remove marker from map
  if (developmentProjectsLayer && developmentProjectsLayer.hasLayer(marker)) {
    developmentProjectsLayer.removeLayer(marker);
  }

  // AI : Remove marker from map
  developmentMarkerMap.delete(projectId);
}

/**
 * AI : Update development marker color for a specific project
 * This is called when a project is modified or when mode changes
 */
export function updateDevelopmentMarkerColor(projectId: string, project: Project): void {
  const marker = developmentMarkerMap.get(projectId);
  if (!marker) return;

  const overlayStore = useOverlayStore();
  const markerColor = getProjectMarkerColor(project, overlayStore.mode);
  const markerIcon = createBasicProjectIcon(markerColor);
  marker.setIcon(markerIcon);
}

/**
 * AI : Update all development marker colors based on current mode
 * Called when switching between view/edit modes
 */
export function updateAllDevelopmentMarkerColors(): void {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();

  developmentMarkerMap.forEach((marker, projectId) => {
    // AI : Try local projects first, then allProjects (includes backend/nearby projects)
    const project = projectStore.projects[projectId] ?? projectStore.allProjects[projectId];
    if (project) {
      const markerColor = getProjectMarkerColor(project, overlayStore.mode);
      const markerIcon = createBasicProjectIcon(markerColor);
      marker.setIcon(markerIcon);
    }
  });
}

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
export function createProjectInfoTeleportTarget(marker: L.Marker | L.CircleMarker) {
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
      cleanupProjectInfoTeleportTarget();
    }
  };
  map.value.on('click', mapClickHandler);
}

/**
 * AI : Clean up teleport target and event listeners
 */
export function cleanupProjectInfoTeleportTarget() {
  // AI : Remove event listeners if map exists
  if (map.value != null) {
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
 * AI : Load projects without overlays (development-style markers) for a specific city and display them on map
 */
export async function loadCityDevelopmentProjects(cityId: string | null): Promise<void> {
  if (!map.value) return;

  // AI : Initialize mode watcher on first use (after Pinia is available)
  initializeModeWatcher();

  try {
    const mapStore = useMapStore();
    const overlayStore = useOverlayStore();

    // AI : Check mode-aware cache first for non-null cityId
    let backendProjects: RouterOutput['project']['getCityProjects'] = [];
    if (cityId) {
      const cachedData = mapStore.getCityDevelopmentProjectsCache(cityId, overlayStore.mode);
      if (cachedData) {
        backendProjects = cachedData;
      } else {
        // AI : Get projects for this city from backend
        // AI : Pass current mode to backend to determine visibility
        backendProjects = await trpc.project.getCityProjects.query({ cityId, mode: overlayStore.mode });
        // AI : Cache the result in mode-specific cache
        mapStore.setCityDevelopmentProjectsCache(cityId, overlayStore.mode, backendProjects);
      }
    }

    // AI : Filter to only projects with no overlays (development-style markers)
    const backendProjectsWithNoOverlays = backendProjects.filter(project => {
      const overlayCount = project.overlayCount ?? 0
      return overlayCount === 0
    });

    // AI : Get local projects with no overlays for this city (handle null cityId case)
    const { projects: localProjects } = useProjects();
    const allLocalProjects = Object.values(localProjects.value);

    const localProjectsWithNoOverlays = allLocalProjects
      .filter(project => {
        const overlayCount = project.overlayIds?.length ?? 0
        const matchesCity = project.cityId === cityId || (cityId === null && (project.cityId === null || project.cityId === undefined))
        return overlayCount === 0 && matchesCity
      });

    // AI : Combine backend and local projects, avoiding duplicates
    const allProjectsWithNoOverlays = [
      ...backendProjectsWithNoOverlays,
      ...localProjectsWithNoOverlays.filter(local =>
        !backendProjectsWithNoOverlays.some(backend => backend.id === local.id)
      )
    ];

    // AI : Remove existing development projects layer
    if (developmentProjectsLayer) {
      map.value.removeLayer(developmentProjectsLayer);
      developmentProjectsLayer = null;
    }
    developmentProjectsLayer = L.layerGroup();

    // AI : Clear the marker map
    developmentMarkerMap.clear();

    allProjectsWithNoOverlays.forEach(project => {
      if (project.lat && project.lng) {
        // AI : Skip if marker already exists (safety check to prevent duplicates)
        if (developmentMarkerMap.has(project.id)) {
          return;
        }

        // AI : Get marker color based on edit mode and status
        const projectData = 'overlayIds' in project ? project : createProject({
          ...project,
          city: {
            ...project.city,
            coordinates: { x: project.city.coordinates.x, y: project.city.coordinates.y },
            createdAt: new Date(),
            updatedAt: new Date()
          },
          status: ('status' in project ? project.status : 'approved') as 'pending' | 'approved' | 'rejected'
        });
        const markerColor = getProjectMarkerColor(projectData, overlayStore.mode);
        const markerIcon = createBasicProjectIcon(markerColor);

        // AI : Create marker with timeline-based color icon and default opacity
        const marker = L.marker([project.lat, project.lng], {
          icon: markerIcon,
          opacity: MARKER_OPACITY.development.default // AI : Lower default opacity to suggest interactivity
        });

        // AI : Prevent double-click zoom on markers
        marker.on('dblclick', (e) => {
          L.DomEvent.stopPropagation(e);
        });

        // AI : Add mouseover event to increase marker opacity
        marker.on('mouseover', () => {
          marker.setOpacity(MARKER_OPACITY.development.hover);
        });

        // AI : Add mouseout event to reset marker opacity (unless it's the selected marker)
        marker.on('mouseout', () => {
          // AI : If this is the selected marker, keep it fully opaque
          if (selectedDevelopmentMarker === marker) {
            marker.setOpacity(MARKER_OPACITY.development.hover);
          } else {
            marker.setOpacity(MARKER_OPACITY.development.default);
          }
        });

        // AI : Add click handler for projects without overlays - show info popup first
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
            status: ('status' in project ? project.status : 'approved') as 'pending' | 'approved' | 'rejected'
          });

          // AI : CRITICAL: Add project to store so it can be edited
          const { projects: localProjects } = useProjects();
          if (!localProjects.value[project.id]) {
            localProjects.value = {
              ...localProjects.value,
              [project.id]: projectData
            };
          }

          // AI : Close overlay popup if it's open (only one popup at a time)
          if (overlayStore.showInfoPopup) {
            overlayStore.hideInfoPopup();
          }
          uiStore.openProjectInfoPopup(project.id, projectData);
        });

        // AI : Store marker in map for easy lookup
        developmentMarkerMap.set(project.id, marker);

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

      // AI : Check if we're switching to a different city
      const previousCityId = mapStore.selectedCity?.id;
      const isSwitchingCity = previousCityId !== cityId;

      mapStore.setSelectedCity({ id: cityId, name: cityName, countryCode: cityCountryCode });

      // AI : Only clear state when actually switching cities, not when refreshing
      if (isSwitchingCity) {
        // AI : Clear selected project when switching cities
        const { selectedProjectId } = useSelectedProject();
        selectedProjectId.value = null;

        // AI : Close project info popup when switching cities
        uiStore.closeProjectInfoPopup();
      }

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
 * AI : NOTE: This does NOT remove development markers - they are managed separately
 * AI : Development markers persist across city marker reloads and are only cleared when changing cities
 */
export function removeCityMarkers(): void {
  if (cityMarkersLayer && map.value != null && map.value.hasLayer(cityMarkersLayer)) {
    map.value.removeLayer(cityMarkersLayer);
    cityMarkersLayer = null;
  }

  cityMarkerMap.clear();
}

/**
 * AI : Shared city marker configuration to avoid code duplication
 */
function getCityMarkerConfig(): MarkerLayerConfig<CityWithProjects> {
  return {
    getOpacity: (hover) => hover ? MARKER_OPACITY.city.hover : MARKER_OPACITY.city.default,
    getColor: () => 'blue',
    getLatLng: (city) => ({ lat: city.lat, lng: city.lng }),
    getTooltip: (city) => city.name,
    getTestId: (city) => `city-marker-${city.id}`,
    getDataAttributes: (city) => ({
      'data-city-id': city.id,
      'data-city-name': city.name,
      'data-country-code': city.countryCode,
      'data-lat': city.lat.toString(),
      'data-lng': city.lng.toString(),
    }),
    onMarkerHover: (marker, city, isHovering) => {
      // AI : Custom hover handler that respects selected city state
      const mapStore = useMapStore();
      const isSelectedCity = mapStore.selectedCity?.id === city.id;

      if (isHovering) {
        // AI : Always increase opacity on hover
        marker.setOpacity(MARKER_OPACITY.city.hover);
      } else if (isSelectedCity) {
        // AI : On mouse out, keep opacity high if this is the selected city
        marker.setOpacity(MARKER_OPACITY.city.hover);
      } else {
        marker.setOpacity(MARKER_OPACITY.city.default);
      }
    },
    onMarkerClick: async (_marker, city) => {
      const mapStore = useMapStore();
      const overlayStore = useOverlayStore();

      // AI : Check for unsaved overlays before loading city (same city or different)
      const hasUnsavedOverlays = Object.values(overlayStore.overlays).some(
        overlay => overlay.isModified === true
      );

      if (hasUnsavedOverlays) {
        const isSwitchingCity = mapStore.selectedCity?.id !== city.id;
        const message = isSwitchingCity
          ? 'You have unsaved overlays. Switching to another city will discard them. Continue?'
          : 'You have unsaved overlays. Reloading this city will discard them. Continue?';

        const confirmed = confirm(message);
        if (!confirmed) {
          return; // AI : User cancelled
        }
      }

      // AI : Zoom to the city marker position (same zoom level as MarkerHelpButton)
      if (map.value && map.value.getZoom() < 14) {
        mobileAwareFlyTo([city.lat, city.lng], 14, {
          duration: 1.5
        });
      }

      await loadCityProjects(city.id, city.name, false, city.countryCode);
    }
  };
}

/**
 * AI : Add a single city marker without replacing existing ones
 */
export function addSingleCityMarker(city: { id: string; name: string; lat: number; lng: number; countryCode: string }): void {
  if (!map.value) {
    onMapInitialized(() => addSingleCityMarker(city));
    return;
  }

  // AI : Don't add if marker already exists
  if (cityMarkerMap.has(city.id)) return;

  // AI : Initialize layer if needed
  if (!cityMarkersLayer) {
    cityMarkersLayer = L.layerGroup().addTo(map.value);
    initializeCityMarkerWatcher();
  }

  // AI : Use shared config to create marker
  const config = getCityMarkerConfig();
  const cityData: CityWithProjects = { ...city, projectCount: 0 };
  const result = createMarkerLayer([cityData], config);

  // AI : Add marker to existing layer
  result.markers.forEach((marker, cityId) => {
    marker.addTo(cityMarkersLayer!);
    cityMarkerMap.set(cityId, marker);
  });
}

/**
 * AI : Add city markers for a specific country
 */
export function addCityMarkersForCountry(cities: CityWithProjects[]): void {
  if (!map.value) {
    onMapInitialized(() => { 
      addCityMarkersToMapInternal(cities) 
    })
    return;
  }
  addCityMarkersToMapInternal(cities);
}

/**
 * AI : Internal function to add city markers to map
 */
function addCityMarkersToMapInternal(cities: CityWithProjects[]): void {
  if (!map.value) return;

  // AI : Remove existing layer to prevent stacking
  if (cityMarkersLayer) {
    map.value.removeLayer(cityMarkersLayer);
  }

  // AI : Use shared config to create markers
  const config = getCityMarkerConfig();
  const result = createMarkerLayer(cities, config);
  cityMarkersLayer = result.layer;

  // AI : Store markers for lookup
  cityMarkerMap.clear();
  result.markers.forEach((marker, cityId) => {
    cityMarkerMap.set(cityId, marker);
  });

  // AI : Initialize watcher and add to map
  initializeCityMarkerWatcher();
  cityMarkersLayer.addTo(map.value);

  // AI : Update opacities for selected city
  const mapStore = useMapStore();
  if (mapStore.selectedCity) {
    updateCityMarkerOpacities(mapStore.selectedCity.id);
  }
}
