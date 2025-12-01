import L from "leaflet";
import { createBasicProjectIcon } from '@composables/map/useMarkers';
import type { Project } from '@types';
import { ref, watch } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import { mobileAwareFlyTo } from '@composables/map/useMapNavigation';
import { loadCityOverlays } from '@composables/map/useCityOverlays';
import { useSelectedProject } from '@composables/project/useProjectSelection';
import { RouterOutput, trpc } from '@client';

import { useAuthStore } from '@stores/authStore';
import { useUiStore } from '@stores/uiStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import { useProjects } from '@composables/project/useProjects';
import { createProjectObject } from '../../utils/typeFactories';
import { getProjectMarkerColor } from '../../utils/markerColors';
import { MARKER_OPACITY } from '@constants/markerConstants';
import { createMarkerLayer, type MarkerLayerConfig } from '@composables/map/useMarkerLayer';
import {
  addStandaloneProjectMarkerForProject,
  getStandaloneProjectMarkerByProjectId,
  getStandaloneProjectMarkerMap,
  updateStandaloneProjectMarkerOpacities,
  clearAllStandaloneProjectMarkers
} from '@composables/map/useStandaloneProjectMarkers';
import { createProjectInfoTeleportTarget, cleanupProjectInfoTeleportTarget as cleanupTeleport } from '@composables/map/useProjectPopupTeleport';


// AI : Type aliases using RouterOutput from tRPC
export type CityWithProjects = RouterOutput['cities']['getCitiesWithProjects'][number];

// AI : Cities with projects data
export const citiesWithProjects = ref<CityWithProjects[]>([]);

// AI : Layer group for city markers
let cityMarkersLayer: L.LayerGroup | null = null;

// AI : Map to store city ID to marker references for easy lookup
const cityMarkerMap = new Map<string, L.Marker>();


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
    updateAllStandaloneProjectMarkerColors();
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
 * AI : Update standalone project marker color for a specific project
 */
export function updateStandaloneProjectMarkerColor(projectId: string, project: Project): void {
  const marker = getStandaloneProjectMarkerByProjectId(projectId);
  if (!marker) return;

  const overlayStore = useOverlayStore();
  const markerColor = getProjectMarkerColor(project, overlayStore.mode);
  const markerIcon = createBasicProjectIcon(markerColor);
  marker.setIcon(markerIcon);
}

/**
 * AI : Update all standalone project marker colors based on current mode
 */
export function updateAllStandaloneProjectMarkerColors(): void {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const markerMap = getStandaloneProjectMarkerMap();

  markerMap.forEach((marker, projectId) => {
    const project = projectStore.projects[projectId] ?? projectStore.allProjects[projectId];
    if (project) {
      const markerColor = getProjectMarkerColor(project, overlayStore.mode);
      const markerIcon = createBasicProjectIcon(markerColor);
      marker.setIcon(markerIcon);
    }
  });
}

// AI : Teleport functions now in shared utility - re-export for backward compatibility
export { createProjectInfoTeleportTarget };
export function cleanupProjectInfoTeleportTarget() {
  cleanupTeleport();
  updateStandaloneProjectMarkerOpacities(null); // AI : Reset marker opacities when popup closes
}

/**
 * AI : Load projects without overlays (standalone project markers) for a specific city and display them on map
 */
export async function loadCityStandaloneProjects(cityId: string | null): Promise<void> {
  if (!map.value) return;

  initializeModeWatcher();

  // AI : Clear all existing standalone project markers to prevent accumulation across cities
  clearAllStandaloneProjectMarkers();

  try {
    const mapStore = useMapStore();
    const overlayStore = useOverlayStore();

    let backendProjects: RouterOutput['project']['getCityProjects'] = [];
    if (cityId) {
      const cachedData = mapStore.getCityStandaloneProjectsCache(cityId, overlayStore.mode);
      if (cachedData) {
        backendProjects = cachedData;
      } else {
        backendProjects = await trpc.project.getCityProjects.query({ cityId, mode: overlayStore.mode });
        mapStore.setCityStandaloneProjectsCache(cityId, overlayStore.mode, backendProjects);
      }
    }

    const backendProjectsWithNoOverlays = backendProjects.filter(project => {
      const overlayCount = project.overlayCount ?? 0
      return overlayCount === 0
    });

    const { projects: localProjects } = useProjects();
    const allLocalProjects = Object.values(localProjects.value);
    const authStore = useAuthStore();

    const localProjectsWithNoOverlays = allLocalProjects
      .filter(project => {
        const overlayCount = project.overlayIds?.length ?? 0
        const matchesCity = project.cityId === cityId || (cityId === null && (project.cityId === null || project.cityId === undefined))

        // AI : Filter by mode and status (same logic as backend)
        let matchesVisibilityFilter = false;
        if (overlayStore.mode === 'view') {
          // AI : View mode: only show approved projects
          matchesVisibilityFilter = project.status === 'approved';
        } else if (overlayStore.mode === 'edit' && authStore.user) {
          // AI : Edit mode: show approved projects OR user's own projects
          matchesVisibilityFilter = project.status === 'approved' || project.ownerId === authStore.user.id;
        } else if (overlayStore.mode === 'moderation') {
          // AI : Moderation mode: show approved OR pending projects
          matchesVisibilityFilter = project.status === 'approved' || project.status === 'pending';
        } else {
          // AI : Default: only show approved
          matchesVisibilityFilter = project.status === 'approved';
        }

        return overlayCount === 0 && matchesCity && matchesVisibilityFilter;
      });

    const allProjectsWithNoOverlays = [
      ...backendProjectsWithNoOverlays,
      ...localProjectsWithNoOverlays.filter(local =>
        !backendProjectsWithNoOverlays.some(backend => backend.id === local.id)
      )
    ];

    // AI : Get set of project IDs that have overlays already rendered in the store
    // AI : This prevents showing standalone project markers for projects that have visible overlays
    // AI : (e.g., pending overlays visible in edit mode, or overlays from a different mode's cache)
    const projectIdsWithRenderedOverlays = new Set(
      Object.values(overlayStore.overlays)
        .map(overlay => overlay.projectId)
        .filter((id): id is string => id !== null && id !== undefined)
    );

    allProjectsWithNoOverlays.forEach(project => {
      // AI : Skip if project already has overlays rendered on the map
      if (projectIdsWithRenderedOverlays.has(project.id)) {
        return;
      }

      if (project.lat && project.lng) {
        const projectData = 'overlayIds' in project ? project : createProjectObject({
          ...project,
          city: project.city,
          status: ('status' in project ? project.status : 'approved') as 'pending' | 'approved' | 'rejected'
        });

        // AI : Add project to store so it can be edited
        const { projects: localProjects } = useProjects();
        if (!localProjects.value[project.id]) {
          localProjects.value = {
            ...localProjects.value,
            [project.id]: projectData
          };
        }

        // AI : Apply completion filters (timeline filters in view mode)
        // AI : In edit/moderation modes, timeline filters don't apply
        if (overlayStore.mode === 'view') {
          const completionFilters = useCompletionFilters();
          const projectColor = getProjectMarkerColor(projectData, overlayStore.mode);

          // AI : Check if this color is in the completion filters (some colors like 'gold', 'black' may not be)
          const colorKey = projectColor as keyof typeof completionFilters.visibleCompletionStates.value;
          const isVisibleByCompletionFilter = colorKey in completionFilters.visibleCompletionStates.value
            ? completionFilters.visibleCompletionStates.value[colorKey]
            : true; // AI : If color not in filters, show by default

          if (!isVisibleByCompletionFilter) {
            return;
          }
        }

        addStandaloneProjectMarkerForProject(projectData);
      }
    });
  } catch (error) {
    console.error('Error loading standalone projects:', error);
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

      // AI : Load both overlay projects and standalone projects
      await Promise.all([
        loadCityOverlays(cityId, forceFullLoad),
        loadCityStandaloneProjects(cityId)
      ]);
    } else {
      // AI : Just load local standalone projects when no city is selected
      await loadCityStandaloneProjects(null);
    }
  } catch (error) {
    console.error('Error loading city projects:', error);
  }
}

/**
 * AI : Remove city markers from the map
 * AI : NOTE: This does NOT remove standalone project markers - they are managed separately
 * AI : Standalone project markers persist across city marker reloads and are only cleared when changing cities
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
