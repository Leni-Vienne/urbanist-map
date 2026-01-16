// AI : City-specific overlay management - handles loading and displaying overlays for cities
import L from "leaflet";
import { map } from "@/services/core/map";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { filterByCompletionStatus } from "@/services/overlay/completionFilters";
import { getOverlayMarkerColor, createOverlayIcon } from "@/services/map/markers";
import { resolveOverlayPosition } from "@/services/overlay/overlayPositionManagement";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useMapStore } from "@/stores/pinia/mapStore";
import type { OverlayData } from "@/types/index";

// AI : Layer group for overlay markers (markers without images)
let overlayMarkersLayer: L.LayerGroup | null = null;

/**
 * AI : Common function to render overlay markers from overlay data
 */
export function renderOverlayMarkersFromData(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();

  // AI : Remove any existing overlay marker layer to prevent accumulation of orphaned layers
  removeOverlayMarkers();

  // AI : Filter overlays based on current completion status filters
  const visibleOverlays = filterByCompletionStatus(overlaysData, overlayStore.mode);

  // AI : Create new layer group for overlay markers
  overlayMarkersLayer = L.layerGroup();

  // AI : Add simple markers for each visible overlay location
  for (const overlay of visibleOverlays) {
    // AI : Skip replaced overlays - they would overlap with their replacement at the same location
    if (overlay.status === "replaced") continue;
    // AI : Use unified position resolver
    const overlayStore = useOverlayStore();
    const resolved = resolveOverlayPosition(overlay.id, overlay, overlayStore.mode);

    // AI : Check edit mode cache for modifications to determine correct marker color
    const cachedModifications =
      overlayStore.mode === "edit" ? overlayStore.getFromEditModeCache(overlay.id) : undefined;

    // AI : Preserve isViewingApprovedPosition from store if it exists
    // AI : This ensures that if user switched to "Approved" view, it persists across zoom levels
    const existingInStore = overlayStore.overlays[overlay.id];

    // AI : Create temporary overlay object with isModified flag
    // AI : Priority: 1) overlay's own isModified, 2) cached isModified, 3) false
    const overlayWithModFlag = {
      ...overlay,
      isModified: overlay.isModified ?? cachedModifications?.isModified ?? false,
      isViewingApprovedPosition: existingInStore?.isViewingApprovedPosition,
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

  // AI : In moderation mode, clicking a contribution should load the city context
  if (overlayStore.mode === "moderation" && overlayData.project?.city) {
    const mapStore = useMapStore();
    const city = overlayData.project.city;

    if (mapStore.selectedCity?.id !== city.id) {
      mapStore.setSelectedCity({
        id: city.id,
        name: city.name,
        nameLocal: city.nameLocal,
        countryCode: city.countryCode,
      });
    }
  }

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
