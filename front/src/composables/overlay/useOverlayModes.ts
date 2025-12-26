// AI : Overlay mode management - orchestrates edit/view mode switching using state machine
import { ref, watch, toRef } from "vue";
import type L from "leaflet";
import { map, currentZoomLevel } from "@/composables/core/useMap";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useAuthStore } from "@/stores/authStore";
import {
  getSelectedCity,
  hasCachedCityProjectsData,
  getCachedCityProjectsData,
} from "@/composables/map/useCityData";
import {
  calculateTransition,
  shouldFullRerender,
  shouldCachePositions,
  type OverlayModeState,
  type ZoomLevel,
  type StateTransition,
} from "./useOverlayModeStateMachine";
import {
  renderForStrategy,
  updateExistingOverlays,
  clearAllRenderedContent,
} from "./useOverlayRenderer";
import { cacheCurrentPosition } from "./useOverlayPositionManagement";
import { loadCityOverlays, fetchCityProjectsData } from "@/composables/map/useCityOverlays";
import {
  loadCityStandaloneProjects,
  removeCityMarkers,
  addCityMarkersForCountry,
  updateAllStandaloneProjectMarkerColors,
} from "@/composables/map/useCityMarkers";
import {
  loadCountriesWithProjects,
  loadCitiesForCountry,
  addCountryMarkersToMap,
} from "@/composables/map/useCountryMarkers";
import { navigateToStandaloneProject } from "@/composables/navigation/useOverlayNavigation";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { updateOverlayMarkersColors } from "@/composables/map/useMarkers";
import { updateOverlayEditingState } from "@/composables/overlay/useOverlay";
import { getOverlayBounds } from "@/composables/overlay/useOverlayMarkers";
import { selectOverlay } from "@/composables/overlay/useOverlaySelection";
import { storeToRefs } from "pinia";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { mobileAwareFlyToBounds } from "@/composables/map/useMapNavigation";
import { clearChangeRequestPreview } from "@/composables/overlay/changeRequestPreviewState";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";

// AI : Transition effects - callbacks executed during state transitions
interface TransitionEffects {
  beforeTransition?: (from: OverlayModeState, to: OverlayModeState) => void;
  afterTransition?: (to: OverlayModeState) => void | Promise<void>;
}

// AI : Constants
const MIN_ZOOM_FOR_OVERLAYS = MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;

// AI : Current state of the overlay system
const currentState = ref<OverlayModeState>({
  mode: "view",
  zoomLevel: "low",
  hasLoadedOverlays: false,
  selectedCityId: null,
});

/**
 * AI : Convert numeric zoom to zoom level category
 */
function getZoomLevel(zoom: number): ZoomLevel {
  return zoom >= MIN_ZOOM_FOR_OVERLAYS ? "high" : "low";
}

/**
 * AI : Get current state based on runtime values
 */
function getCurrentState(): OverlayModeState {
  const overlayStore = useOverlayStore();
  const selectedCity = getSelectedCity();
  const zoom = map.value?.getZoom() ?? 0;

  return {
    mode: overlayStore.mode,
    zoomLevel: getZoomLevel(zoom),
    hasLoadedOverlays: Object.keys(overlayStore.overlays).length > 0,
    selectedCityId: selectedCity?.id ?? null,
  };
}

/**
 * AI : Execute a state transition with optional side effects
 */
async function transitionToState(newState: OverlayModeState, effects?: TransitionEffects) {
  const transition = calculateTransition(currentState.value, newState);

  // AI : Execute before-transition effects
  effects?.beforeTransition?.(currentState.value, newState);

  // AI : Determine if we need full re-render or just updates
  if (shouldFullRerender(transition)) {
    performFullRender(newState, transition);
  } else {
    performPartialUpdate(transition);
  }

  // AI : Update current state
  currentState.value = newState;

  // AI : Execute after-transition effects (fire-and-forget for async effects)
  await effects?.afterTransition?.(newState);
}

/**
 * AI : Perform full re-render with new state
 */
function performFullRender(newState: OverlayModeState, transition: StateTransition): void {
  const selectedCity = getSelectedCity();

  if (!selectedCity || !newState.selectedCityId) {
    clearAllRenderedContent();
    return;
  }

  // AI : Get overlays data for the city from mode-aware cache
  if (hasCachedCityProjectsData(newState.selectedCityId, newState.mode)) {
    const overlaysData = getCachedCityProjectsData(newState.selectedCityId, newState.mode);
    if (overlaysData) {
      renderForStrategy(transition.renderStrategy, overlaysData, newState.selectedCityId);
    }
  }
}

/**
 * AI : Perform partial update (positions/controls only)
 * AI : Used when state changes don't require full re-render (e.g., just zoom level change)
 */
function performPartialUpdate(transition: StateTransition): void {
  // AI : Simply update properties of existing overlays (positions, editing state, visibility)
  // AI : This preserves Leaflet instances and their internal state (selection, etc.)
  updateExistingOverlays(transition.renderStrategy);
}

/**
 * AI : Shared logic for reloading cities and updating map markers
 */
async function reloadCitiesAndMarkers(countryCode: string): Promise<void> {
  await loadCitiesForCountry(countryCode);

  // AI : Update city markers on the map with the new cities list
  removeCityMarkers();
  const projectStore = useProjectStore();
  const { countries } = storeToRefs(projectStore);
  const currentCountry = countries.value.find((c) => c.code === countryCode);
  if (currentCountry && currentCountry.cities.length > 0) {
    const citiesWithProjectCount = currentCountry.cities.map((c) =>
      Object.assign({}, c, { projectCount: 0 }),
    );
    addCityMarkersForCountry(citiesWithProjectCount);
  }
}

/**
 * AI : Shared before-transition logic for caching overlay positions
 */
function handleBeforeTransition(from: OverlayModeState, to: OverlayModeState): void {
  // AI : Cache positions when leaving edit mode (using predicate)
  if (shouldCachePositions(from, to)) {
    const overlayStore = useOverlayStore();
    for (const overlay of Object.values(overlayStore.overlays)) {
      cacheCurrentPosition(overlay);
    }
  }
}

/**
 * AI : Switch to a specific map mode (view/edit/moderation)
 * AI : Handles full state machine transition with smart mode-aware caching
 * AI : Uses cached data if available for target mode, otherwise fetches from backend
 * AI : Auto-navigates to show both previous and new overlay positions after mode change
 */
export async function switchMode(
  targetMode: "view" | "edit" | "moderation",
  onModeExit?: () => void,
): Promise<void> {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const uiStore = useUiStore();
  const authStore = useAuthStore();
  const toast = useToast();
  // AI : Don't do anything if we're already in the target mode
  if (overlayStore.mode === targetMode) {
    return;
  }

  // AI : Store selected overlay ID before mode switch for auto-navigation
  const selectedOverlayId = overlayStore.idSelectedOverlay;

  // AI : Capture the current position of selected overlay BEFORE mode switch
  // AI : This allows us to show both old and new positions after the switch
  let previousBounds: L.LatLngBounds | null = null;
  let selectedOverlayProjectId: string | null = null;
  let selectedOverlayWasPending = false;
  if (selectedOverlayId) {
    const currentOverlay = overlayStore.overlays[selectedOverlayId];
    if (currentOverlay) {
      previousBounds = getOverlayBounds(currentOverlay);
      selectedOverlayProjectId = currentOverlay.projectId ?? null;
      // AI : Track if the overlay was pending - only pending overlays become invisible in view mode
      selectedOverlayWasPending = currentOverlay.status === "pending";
    }
  }

  // AI : Capture project popup state before mode switch
  // AI : If switching to edit/moderation mode with a project popup open, we'll auto-select an overlay from that project
  const projectPopupProjectId =
    (targetMode === "edit" || targetMode === "moderation") && uiStore.projectInfoPopup.visible
      ? uiStore.projectInfoPopup.projectId
      : null;

  // AI : Reset all toggle states when switching modes for consistent UX
  // AI : Each mode has its default view, toggling is temporary within that mode
  for (const overlay of Object.values(overlayStore.overlays)) {
    overlay.isViewingApprovedPosition = undefined;
  }

  // AI : Clear change request preview state when switching modes
  // AI : This ensures buttons don't show "pressed" state after mode switch
  clearChangeRequestPreview();

  // AI : If switching to moderation mode, ensure the user has rights to the currently selected area
  // AI : If not, clear the selection to avoid showing an empty panel or confusing state
  if (targetMode === "moderation") {
    const user = authStore.user;
    // AI : If user has specific moderated countries (not admin/all-access)
    if (user?.moderatedCountries) {
      // AI : Check if current selection matches user's permissions
      const currentCountryCode = mapStore.selectedCity?.countryCode ?? mapStore.selectedCountryCode;

      if (currentCountryCode && !user.moderatedCountries.includes(currentCountryCode)) {
        // AI : User strictly moderated and current selection is not in their list -> clear it
        mapStore.clearSelectedCity();
        mapStore.selectedCountryCode = null;

        // AI : Inform user with a toast
        toast.add({
          severity: "info",
          summary: t("moderation.title"),
          detail: t("moderation.noAccessToThisCountry"),
          life: 4000,
        });
      }
    }
  }

  // AI : Set new mode
  overlayStore.setMode(targetMode);

  // AI : Calculate new state
  const newState = getCurrentState();
  const selectedCity = getSelectedCity();

  // AI : NO cache invalidation! Smart caching handles mode-specific data automatically
  // AI : fetchCityProjectsData and loadCityStandaloneProjects check mode-aware cache first
  // AI : If cached data exists for target mode, uses it instantly (no backend call)
  // AI : If not cached, fetches from backend and caches for future use

  // AI : Fetch data for new mode BEFORE transitioning (uses smart cache)
  if (
    selectedCity &&
    newState.selectedCityId &&
    newState.hasLoadedOverlays &&
    newState.zoomLevel === "high"
  ) {
    await fetchCityProjectsData(newState.selectedCityId);
  } else if (selectedCity && newState.selectedCityId) {
    // AI : Not switching cities during mode change, just switching modes
    await loadCityOverlays(newState.selectedCityId, false, false);
  }

  // AI : Execute state transition with side effects
  await transitionToState(newState, {
    beforeTransition: handleBeforeTransition,
    afterTransition: async () => {
      // AI : Load standalone projects AFTER overlays are rendered to correctly detect which projects need markers
      if (selectedCity && newState.selectedCityId) {
        await loadCityStandaloneProjects(newState.selectedCityId);
      }

      // AI : Update overlay editing state (toolbar actions, draggability) after mode switch
      updateOverlayEditingState();

      // AI : Update overlay marker colors immediately after mode switch
      updateOverlayMarkersColors(toRef(overlayStore, "overlays"));

      // AI : Update standalone project marker colors immediately after mode switch
      updateAllStandaloneProjectMarkerColors();

      // AI : Load countries first (required for reloadCitiesAndMarkers)
      await loadCountriesWithProjects();

      // AI : Then reload city markers if a country is selected
      const countryCode = mapStore.selectedCountryCode;
      if (countryCode) {
        await reloadCitiesAndMarkers(countryCode);
      }

      // AI : Add country markers after both requests complete
      addCountryMarkersToMap();

      // AI : If project popup was open for a standalone project, auto-select first overlay from that project
      // AI : This provides continuity when switching from view mode (with project marker popup) to edit/moderation mode
      // AI : Do this INSTEAD of auto-navigate since we want to show toolbar, not fly to overlay
      if (projectPopupProjectId) {
        await autoSelectOverlayForProject(projectPopupProjectId);
      } else if (selectedOverlayId) {
        // AI : Check if switching from edit/moderation to view mode with a pending overlay selected
        // AI : Only fly to standalone marker if overlay was pending (pending overlays are invisible in view mode)
        // AI : Approved overlays remain visible, so they should use normal overlay navigation
        if (targetMode === "view" && selectedOverlayProjectId && selectedOverlayWasPending) {
          await autoNavigateToStandaloneMarker(selectedOverlayProjectId);
        } else {
          // AI : Auto-navigate to selected overlay after mode change (only if not from project popup)
          // AI : Pass previousBounds so we can show both old and new positions
          await autoNavigateToSelectedOverlay(selectedOverlayId, previousBounds);
        }
      }

      // AI : Call onModeExit when leaving edit mode
      if (targetMode !== "edit" && onModeExit) {
        onModeExit();
      }
    },
  });
}

/**
 * AI : Auto-navigate to the selected overlay after mode change
 * AI : Creates a combined view showing both the previous position and new position
 * AI : This prevents jarring camera jumps by unzooming to show both positions
 * @param overlayId - ID of the selected overlay
 * @param previousBounds - Bounds of the overlay position before mode switch
 */
async function autoNavigateToSelectedOverlay(
  overlayId: string,
  previousBounds: L.LatLngBounds | null,
): Promise<void> {
  const overlayStore = useOverlayStore();

  // AI : Get overlay directly from store - no polling needed since renderForStrategy() runs synchronously
  // AI : before this afterTransition callback is executed, so overlays are already in the store
  const overlayObject = overlayStore.overlays[overlayId];

  if (!overlayObject?.corners || overlayObject.corners.length !== 4) {
    console.warn("Overlay not ready for navigation:", overlayId);
    return;
  }

  // AI : Navigate to the overlay bounds using getOverlayBounds for accurate position
  if (!map.value) return;

  // AI : Get actual overlay position using getOverlayBounds
  const newBounds = getOverlayBounds(overlayObject);

  if (newBounds) {
    // AI : If we have previous bounds, create combined bounds to show both positions
    // AI : This creates a smooth unzoom effect instead of jarring camera jump
    let targetBounds = newBounds;

    if (previousBounds) {
      // AI : Extend bounds to include both old and new positions
      targetBounds = newBounds.extend(previousBounds);
    }

    mobileAwareFlyToBounds(targetBounds, {
      padding: [50, 50] as [number, number],
      duration: 0.8, // Change in overlay position between mode is smaller, so quicker transition
      easeLinearity: 0.25,
    });
  }
}

/**
 * AI : Auto-navigate to standalone marker after switching to view mode
 * AI : Used when switching from edit/moderation mode with a selected pending overlay to view mode
 * AI : Flies to the standalone marker that replaces the pending overlay
 * @param projectId - ID of the project
 * @param previousBounds - Bounds of the overlay position before mode switch (unused, kept for consistency)
 */
async function autoNavigateToStandaloneMarker(projectId: string): Promise<void> {
  // AI : Get project data to extract coordinates and city info
  const projectStore = useProjectStore();
  const project = projectStore.projects[projectId];

  if (!project?.lat || !project?.lng || !project?.cityId) {
    console.warn("Project data incomplete for navigation:", projectId);
    return;
  }

  // AI : Get city info for navigation
  const mapStore = useMapStore();
  const selectedCity = mapStore.selectedCity;

  if (!selectedCity) {
    console.warn("No city selected for navigation");
    return;
  }

  // AI : Use existing navigateToStandaloneProject which handles everything:
  // AI : - Cross-country flight support
  // AI : - Proper marker loading
  // AI : - Smooth camera animation
  // AI : Note: We don't open the popup (projectId param omitted) to avoid confusion
  await navigateToStandaloneProject(
    project.lat,
    project.lng,
    selectedCity.id,
    selectedCity.name,
    selectedCity.countryCode,
  );
}

/**
 * AI : Auto-select the first overlay for a project after mode switch
 * AI : Used when switching from view mode (with project popup) to edit/moderation mode
 * AI : Flies to the overlay to provide visual continuity for the user
 */
async function autoSelectOverlayForProject(projectId: string): Promise<void> {
  const overlayStore = useOverlayStore();

  // AI : Wait one frame to ensure DOM updates have propagated
  // AI : This is only needed for UI coordination, overlays are already in store
  await new Promise((resolve) => requestAnimationFrame(resolve));

  // AI : Find an overlay belonging to this project
  const projectOverlay = Object.values(overlayStore.overlays).find(
    (overlay) => overlay.projectId === projectId,
  );

  if (projectOverlay) {
    // AI : Get overlay bounds for navigation
    const overlayBounds = getOverlayBounds(projectOverlay);

    if (overlayBounds && map.value) {
      // AI : Fly to overlay position to show user where the pending overlay is
      mobileAwareFlyToBounds(overlayBounds, {
        padding: [50, 50] as [number, number],
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }

    // AI : selectOverlay handles overlay.select() internally
    selectOverlay(projectOverlay.id);
  }
}

/**
 * AI : Watch for zoom level changes and update state
 */
function watchZoomLevel() {
  watch(currentZoomLevel, async (newZoom) => {
    const newState = getCurrentState();
    newState.zoomLevel = getZoomLevel(newZoom);

    // AI : Only transition if zoom level actually changed categories
    if (newState.zoomLevel !== currentState.value.zoomLevel) {
      await transitionToState(newState);
    }
  });
}

// AI : Initialize zoom watcher and set initial state
// AI : This is called from MapView.vue after map initialization
export function initializeOverlayModes() {
  if (!map.value) {
    console.error("Map not initialized when trying to initialize overlay modes");
    return;
  }

  watchZoomLevel();
  currentState.value = getCurrentState();
}
