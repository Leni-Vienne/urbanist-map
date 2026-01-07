// AI : City-specific overlay management - handles loading and displaying overlays for cities
import { ref } from "vue";
import L from "leaflet";
import { map } from "@/composables/core/useMap";
import { selectOverlay } from "@/composables/overlay/useOverlaySelection";
import { useCompletionFilters } from "@/composables/overlay/useCompletionFilters";
import { getOverlayMarkerColor, createOverlayIcon } from "@/composables/map/useMarkers";
import { resolveOverlayPosition } from "@/composables/overlay/useOverlayPositionManagement";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { mobileAwareFlyToBounds } from "@/composables/map/useMapNavigation";
import type { OverlayData } from "@/types/index";

// AI : Layer group for overlay markers (markers without images)
let overlayMarkersLayer: L.LayerGroup | null = null;

// AI : Loading states
const isLoadingCityProjects = ref(false);

/**
 * AI : Common function to render overlay markers from overlay data
 */
export function renderOverlayMarkersFromData(overlaysData: OverlayData[]): void {
  // AI : Remove any existing overlay marker layer to prevent accumulation of orphaned layers
  removeOverlayMarkers();

  // AI : Filter overlays based on current completion status filters
  const completionFilters = useCompletionFilters();
  const visibleOverlays = completionFilters.filterByCompletionStatus(overlaysData);

  // AI : Create new layer group for overlay markers
  overlayMarkersLayer = L.layerGroup();

  // AI : Add simple markers for each visible overlay location
  for (const overlay of visibleOverlays) {
    // AI : Use unified position resolver
    const overlayStore = useOverlayStore();
    const resolved = resolveOverlayPosition(overlay.id, overlay, overlayStore.mode);

    // AI : Check edit mode cache for modifications to determine correct marker color
    const cachedModifications =
      overlayStore.mode === "edit" ? overlayStore.getFromEditModeCache(overlay.id) : undefined;

    // AI : Create temporary overlay object with isModified flag
    // AI : Priority: 1) overlay's own isModified, 2) cached isModified, 3) false
    const overlayWithModFlag = {
      ...overlay,
      isModified: overlay.isModified ?? cachedModifications?.isModified ?? false,
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

    overlayMarkersLayer?.addLayer(marker);
  }

  // AI : Add overlay markers to map
  if (map.value !== null) {
    overlayMarkersLayer.addTo(map.value);
  }
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

// AI : Export loading state for external use
export { isLoadingCityProjects };
