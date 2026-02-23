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
// AI : Track IDs of dot-markers registered in allMarkers so removeOverlayMarkers can promote
// AI : them to standalone Leaflet layers before destroying the group.
// AI : Module-level state — only cleared inside removeOverlayMarkers. Stale IDs are harmless
// AI : because the promotion loop guards on allMarkers[id] existence.
const dotMarkerIds = new Set<string>();

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
    // AI : Skip overlays that already have a store-managed marker (zoom 14→13 crossing).
    // AI : Those markers are preserved on the Leaflet map; adding another here would create duplicates.
    if (overlayStore.allMarkers[overlay.id]) continue;
    // AI : Use unified position resolver
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

    overlayMarkersLayer.addLayer(marker);
    // AI : Register in allMarkers so createSingleMarker's guard fires at zoom 14 instead of
    // AI : creating a duplicate. onOverlayFullyLoaded will wire the final overlay object to
    // AI : this same marker instance via allMarkers. Track the ID for promotion in removeOverlayMarkers.
    overlayStore.allMarkers[overlay.id] = marker;
    dotMarkerIds.add(overlay.id);
  }
  // AI : Add overlay markers to map
  overlayMarkersLayer.addTo(map.value);
}

/**
 * AI : Remove overlay markers from the map
 * @param promoteToStandalone - If true, re-add dot-markers as standalone Leaflet layers
 *   after the layer group is destroyed. Used during zoom 13→14 transition so that markers
 *   stay visible while full overlay images load asynchronously.
 *   When false (default), dot-marker entries are also removed from allMarkers so that
 *   the next renderOverlayMarkersFromData call can create fresh dot markers.
 */
export function removeOverlayMarkers(promoteToStandalone = false): void {
  if (overlayMarkersLayer) {
    const overlayStore = useOverlayStore();

    // AI : MUST remove the layer group first. Leaflet's LayerGroup.onRemove iterates
    // AI : its children and calls map.removeLayer(child) for each, so all child markers
    // AI : are removed from the map. Calling addTo(map) BEFORE this is a no-op because
    // AI : the marker is already on the map (via the group).
    map.value.removeLayer(overlayMarkersLayer);
    overlayMarkersLayer = null;

    if (promoteToStandalone) {
      // AI : Re-add dot-markers that are still in allMarkers as standalone layers.
      // AI : Now that the layer group is destroyed, addTo(map) actually registers them.
      // AI : They remain visible while overlay images load; onOverlayFullyLoaded will
      // AI : wire them as the overlay's .marker via allMarkers lookup.
      for (const id of dotMarkerIds) {
        const marker = overlayStore.allMarkers[id];
        if (marker) {
          marker.addTo(map.value);
        }
      }
    } else {
      // AI : Full cleanup: also remove dot-marker entries from allMarkers.
      // AI : Without this, the allMarkers guard in renderOverlayMarkersFromData would
      // AI : skip creating new dot markers for these overlays.
      for (const id of dotMarkerIds) {
        delete overlayStore.allMarkers[id];
      }
    }
    dotMarkerIds.clear();
  }
}

/**
 * AI : Fly to overlay marker position and open toolbar
 */
function flyToOverlayMarker(overlayData: OverlayData) {
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

// AI : Accept HMR updates for this module
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
