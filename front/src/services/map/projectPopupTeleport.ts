// Shared teleport target management for project info popups.
// Uses an invisible maplibregl.Marker as the anchor (same technique as OverlayFloatingToolbar)
// so MapLibre positions the teleport target on pan/zoom automatically.

import maplibregl from "maplibre-gl";
import { map } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import { setProjectPopupTarget } from "@/services/map/popupState";
import { unhighlightProjectShapes } from "@/services/map/shapeLayerRegistry";

let anchorMarker: maplibregl.Marker | null = null;
let mapClickHandler: (() => void) | null = null;

// Set to true by vector/marker click handlers to suppress the map-level close handler
// for that same click event (both fire synchronously on the same map click).
let suppressNextPopupClose = false;

export function suppressPopupCloseForClick(): void {
  suppressNextPopupClose = true;
  // Reset after current event loop so it only applies to this click.
  setTimeout(() => {
    suppressNextPopupClose = false;
  }, 0);
}

function createAnchorMarker(lngLat: [number, number]): maplibregl.Marker {
  const el = document.createElement("div");
  el.style.zIndex = "610";
  el.style.pointerEvents = "none";
  el.style.overflow = "visible";
  return new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat(lngLat)
    .addTo(map.value);
}

function attachClickHandler() {
  mapClickHandler = () => {
    if (suppressNextPopupClose) return;
    const uiStore = useUiStore();
    if (uiStore.projectInfoPopup.visible) {
      const projectId = uiStore.projectInfoPopup.projectId;
      uiStore.closeProjectInfoPopup();
      cleanupProjectInfoTeleportTarget();
      if (projectId) unhighlightProjectShapes(projectId);
    }
  };
  map.value.on("click", mapClickHandler);
}

/**
 * Create teleport target for project info popup at a map position.
 * If a target already exists (switching projects), just moves the anchor.
 */
export function createProjectInfoTeleportTargetAtLatLng(latlng: { lat: number; lng: number }) {
  if (anchorMarker) {
    anchorMarker.setLngLat([latlng.lng, latlng.lat]);
    return;
  }

  anchorMarker = createAnchorMarker([latlng.lng, latlng.lat]);
  setProjectPopupTarget(anchorMarker.getElement());
  attachClickHandler();
}

/**
 * Create teleport target for project info popup at a marker's position.
 */
export function createProjectInfoTeleportTarget(marker: maplibregl.Marker) {
  const lngLat = marker.getLngLat();
  createProjectInfoTeleportTargetAtLatLng({ lat: lngLat.lat, lng: lngLat.lng });
}

/**
 * Return the current popup anchor position.
 * Must be called before cleanupProjectInfoTeleportTarget() clears the state.
 */
export function getPopupLatLng(): { lat: number; lng: number } | null {
  if (!anchorMarker) return null;
  const lngLat = anchorMarker.getLngLat();
  return { lat: lngLat.lat, lng: lngLat.lng };
}

/**
 * Clean up the anchor marker and event listeners.
 */
export function cleanupProjectInfoTeleportTarget() {
  if (mapClickHandler) {
    map.value.off("click", mapClickHandler);
    mapClickHandler = null;
  }

  anchorMarker?.remove();
  anchorMarker = null;

  setProjectPopupTarget(null);
}
