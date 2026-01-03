// AI : City-specific overlay management - handles loading and displaying overlays for cities
import { ref } from "vue";
import L from "leaflet";
import { map } from "@/composables/core/useMap";
import { renderViewModeOverlays } from "@/composables/overlay/useOverlay";
import { selectOverlay } from "@/composables/overlay/useOverlaySelection";
import { clearAllOverlays } from "@/composables/overlay/useOverlayLifecycle";
import { hasCachedCityProjectsData, getSelectedCity } from "@/composables/map/useCityData";
import { useCompletionFilters } from "@/composables/overlay/useCompletionFilters";
import { trpc } from "@/client";
import { getOverlayMarkerColor, createOverlayIcon } from "@/composables/map/useMarkers";
import { resolveOverlayPosition } from "@/composables/overlay/useOverlayPositionManagement";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { withErrorHandling, withErrorToast } from "@/composables/core/useErrorHandling";
import { mobileAwareFlyToBounds } from "@/composables/map/useMapNavigation";
import type { OverlayData } from "@/types/index";
import { MAP_CONFIG } from "@/constants/mapConstants";

// AI : Minimum zoom level required to load city projects and overlays
const MIN_ZOOM_FOR_OVERLAYS = MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;

// AI : Layer group for overlay markers (markers without images)
let overlayMarkersLayer: L.LayerGroup | null = null;

// AI : Loading states
const isLoadingCityProjects = ref(false);

/**
 * AI : Fetch city projects data with mode-aware caching to avoid repeated API calls
 * AI : Smart caching: Returns cached data if available for current mode, otherwise fetches from backend
 */
export async function fetchCityProjectsData(cityId: number): Promise<OverlayData[]> {
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();

  // AI : Check if we already have cached data for this city AND current mode
  const cachedData = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode);
  if (cachedData) {
    return cachedData;
  }

  // AI : Backend now returns data in OverlayData format with consistent fields:
  // AI : - corners = ALWAYS approved position
  // AI : - suggestedCorners = pending changes if they exist
  const overlaysData = await withErrorToast(
    async () => trpc.cities.getCityOverlaysAndProjects.query({ cityId, mode: overlayStore.mode }),
    "Error fetching city projects data",
  );

  // AI : Cache the data for future use - mode-specific cache
  mapStore.setCityProjectsCache(cityId, overlayStore.mode, overlaysData);

  return overlaysData;
}

/**
 * AI : Load projects for a specific city and display overlays on map
 */
export async function loadCityOverlays(
  cityId: number,
  forceFullLoad = false,
  isSwitchingCity = true,
): Promise<void | null> {
  return withErrorHandling(
    async () => {
      const mapStore = useMapStore();

      // AI : Check if user is zoomed in enough to load full overlays
      if (!map.value) {
        return;
      }

      const currentZoom = map.value.getZoom();

      // AI : Check if we have cached data for current mode and decide what to show
      const overlayStore = useOverlayStore();
      const hasCachedData = hasCachedCityProjectsData(cityId, overlayStore.mode);
      const shouldShowFullOverlays = currentZoom >= MIN_ZOOM_FOR_OVERLAYS || forceFullLoad;

      if (hasCachedData && shouldShowFullOverlays) {
        // AI : We have cached data and zoom is high enough - show full overlays immediately
        // AI : Only clear overlays if switching cities to prevent glitches
        renderFullOverlaysFromCache(cityId, isSwitchingCity);
        return;
      } else if (hasCachedData && !shouldShowFullOverlays) {
        // AI : We have cached data but zoom is too low - show markers only
        renderOverlayMarkersFromCache(cityId);
        return;
      }

      // AI : No cached data - need to fetch from API
      // AI : If zoom is too low and not forcing full load, show overlay markers only
      if (currentZoom < MIN_ZOOM_FOR_OVERLAYS && !forceFullLoad) {
        await showOverlayMarkers(cityId, isSwitchingCity);
        return;
      }

      // AI : Load full overlays
      isLoadingCityProjects.value = true;

      // AI : Only clear existing overlays and markers when switching cities to prevent glitches
      if (isSwitchingCity) {
        clearAllOverlays();
        removeOverlayMarkers();
      }

      // AI : Get overlays data (cached or fresh)
      const overlaysData = await fetchCityProjectsData(cityId);

      mapStore.currentCityOverlays = overlaysData;

      // AI : Filter overlays based on current completion status filters
      const completionFilters = useCompletionFilters();
      const overlaysToRender = completionFilters.filterByCompletionStatus(overlaysData);

      // AI : Set overlays in view mode overlays and render them
      overlayStore.setViewModeOverlays(overlaysToRender);

      // AI : Render only visible overlays on the map with markers
      renderViewModeOverlays(overlaysToRender, true, true);

      // AI : Check zoom level after loading to ensure overlays are hidden if zoom is too low
      checkZoomAndHideOverlays();
    },
    {
      errorMessage: "Failed to load city overlays",
      logError: true,
      onError: () => {
        const mapStore = useMapStore();
        mapStore.currentCityOverlays = [];
        isLoadingCityProjects.value = false;
      },
    },
  );
}

/**
 * AI : Common function to render overlay markers from overlay data
 */
export function renderOverlayMarkersFromData(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();

  // AI : Remove any existing overlay marker layer to prevent accumulation of orphaned layers
  removeOverlayMarkers();

  // AI : Filter overlays based on current completion status filters
  const completionFilters = useCompletionFilters();
  const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData);

  // AI : Create new layer group for overlay markers
  overlayMarkersLayer = L.layerGroup();

  // AI : Add simple markers for each visible overlay location
  visibleOverlays.forEach((overlay) => {
    // AI : Use unified position resolver
    const overlayStore = useOverlayStore();
    const resolved = resolveOverlayPosition(overlay.id, overlay, overlayStore.mode);

    // AI : Check edit mode cache for modifications to determine correct marker color
    const cachedModifications =
      overlayStore.mode === "edit" ? overlayStore.getFromEditModeCache(overlay.id) : undefined;

    // AI : Create temporary overlay object with isModified flag from cache
    const overlayWithModFlag = {
      ...overlay,
      isModified: cachedModifications?.isModified ?? false,
    };

    const markerColor = getOverlayMarkerColor(overlayWithModFlag, overlayStore.mode);
    const markerIcon = createOverlayIcon(markerColor);
    const marker = L.marker([resolved.position.lat, resolved.position.lng], { icon: markerIcon });

    // AI : Add click handler to fly to overlay position and open toolbar
    marker.on("click", (e) => {
      // AI : Stop propagation to prevent map click handler from deselecting
      L.DomEvent.stopPropagation(e);
      flyToOverlayMarker(overlay);
    });

    // AI : Add data-testid to the marker element after it's added to the DOM
    marker.on("add", () => {
      const markerElement = marker.getElement();
      if (markerElement) {
        markerElement.setAttribute("data-testid", `overlay-marker-${overlay.id}`);
        markerElement.setAttribute("data-overlay-id", overlay.id);
        markerElement.setAttribute("data-project-id", overlay.projectId ?? "unknown");
        markerElement.setAttribute("data-overlay-status", overlay.project?.status ?? "unknown");
      }
    });

    overlayMarkersLayer!.addLayer(marker);
  });

  // AI : Add overlay markers to map
  if (map.value != null) {
    overlayMarkersLayer.addTo(map.value);
  }
}

async function showOverlayMarkers(cityId: number, isSwitchingCity = true): Promise<void> {
  return withErrorHandling(
    async () => {
      const mapStore = useMapStore();
      isLoadingCityProjects.value = true;

      // AI : Only clear existing overlays and markers when switching cities to prevent glitches
      if (isSwitchingCity) {
        clearAllOverlays();
        removeOverlayMarkers();
      }

      // AI : Get overlays data (cached or fresh)
      const overlaysData = await fetchCityProjectsData(cityId);

      // AI : Store overlay data for navigation (even though we're only showing markers)
      mapStore.currentCityOverlays = overlaysData;

      // AI : Use shared function to render markers
      renderOverlayMarkersFromData(overlaysData);
    },
    {
      errorMessage: "Failed to load overlay markers",
      logError: true,
      onError: () => {
        isLoadingCityProjects.value = false;
      },
    },
  ) as Promise<void>;
}

/**
 * AI : Remove overlay markers from the map
 */
export function removeOverlayMarkers(): void {
  if (map.value && overlayMarkersLayer) {
    map.value.removeLayer(overlayMarkersLayer);
    overlayMarkersLayer = null;
  }
}

/**
 * AI : Render full overlays from cached data for current mode
 */
function renderFullOverlaysFromCache(cityId: number, isSwitchingCity = true) {
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();
  const overlaysData = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode);
  if (!overlaysData) {
    return;
  }

  void withErrorHandling(
    () => {
      // AI : Only clear existing overlays and markers when switching cities to prevent glitches
      if (isSwitchingCity) {
        clearAllOverlays();
        removeOverlayMarkers();
      }

      const overlayStore = useOverlayStore();
      mapStore.currentCityOverlays = overlaysData;

      // AI : Filter overlays based on current completion status filters
      const completionFilters = useCompletionFilters();
      const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData);

      // AI : Set overlays in view mode overlays and render them
      overlayStore.setViewModeOverlays(visibleOverlays);

      // AI : Render only visible overlays on the map with markers
      renderViewModeOverlays(visibleOverlays, true, true);
    },
    { errorMessage: "Failed to render cached overlays", logError: true },
  );
}

/**
 * AI : Render overlay markers from cached data for current mode
 */
export function renderOverlayMarkersFromCache(cityId: number): void {
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();
  const overlaysData = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode);
  if (!overlaysData) {
    return;
  }

  void withErrorHandling(
    () => {
      // AI : Store overlay data for navigation (even though we're only showing markers)
      mapStore.currentCityOverlays = overlaysData;

      // AI : Only remove overlay markers if they exist, don't clear all overlays
      removeOverlayMarkers();

      // AI : Use shared function to render markers
      renderOverlayMarkersFromData(overlaysData);
    },
    { errorMessage: "Failed to render cached overlay markers", logError: true },
  );
}

/**
 * AI : Check current zoom and hide overlays if needed
 */
export function checkZoomAndHideOverlays(): void {
  if (!map.value) return;

  const currentZoom = map.value.getZoom();

  if (currentZoom < MIN_ZOOM_FOR_OVERLAYS) {
    // AI : Clear overlays from map when zoom is too low
    clearAllOverlays();
    // AI : Note: We don't clear mapStore.currentCityOverlays because it's needed for navigation
  }
}

/**
 * AI : Fly to overlay marker position and open toolbar
 */
function flyToOverlayMarker(overlayData: OverlayData) {
  if (!map.value) return;

  const overlayStore = useOverlayStore();
  const resolved = resolveOverlayPosition(overlayData.id, overlayData, overlayStore.mode);

  if (resolved.corners?.length !== 4) return;

  const bounds = L.latLngBounds(resolved.corners.map((c) => L.latLng(c.lat, c.lng)));

  mobileAwareFlyToBounds(bounds, {
    padding: [50, 50] as [number, number],
    duration: 1.5,
    easeLinearity: 0.25,
  });

  map.value.once("moveend", () => {
    // AI : selectOverlay handles overlay.select() internally
    selectOverlay(overlayData.id);
  });
}

/**
 * AI : Update overlay markers when completion filters change
 * This function updates markers based on current filter state (works in both edit and view mode)
 */
export function updateOverlayMarkersForFilters(): void {
  const selectedCity = getSelectedCity();
  const overlayStore = useOverlayStore();

  // AI : Only update if we have overlay markers visible
  if (!overlayMarkersLayer || (map.value != null && !map.value.hasLayer(overlayMarkersLayer))) {
    return;
  }

  // AI : Get the current city data from cache for current mode
  if (!selectedCity || !hasCachedCityProjectsData(selectedCity.id, overlayStore.mode)) {
    return;
  }

  // AI : Re-render overlay markers with current filters applied
  renderOverlayMarkersFromCache(selectedCity.id);
}

// AI : Export loading state for external use
export { isLoadingCityProjects };
