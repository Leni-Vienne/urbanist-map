// Shared teleport target management for project info popups.
//
// Uses an invisible Leaflet anchor marker (same technique as OverlayFloatingToolbar) so
// Leaflet's CSS transform on the marker pane handles smooth pan/zoom automatically —
// no manual move/zoom/resize recalculation needed.

import L from "leaflet";
import { map } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import { setProjectPopupTarget } from "@/services/map/popupState";
import { unhighlightProjectShapes } from "@/services/map/shapeRendering";

let anchorMarker: L.Marker | null = null;
let mapClickHandler: (() => void) | null = null;

// Set to true by vector/marker click handlers to suppress the map-level close handler
// for that same click event (both fire synchronously on the same Leaflet click).
let suppressNextPopupClose = false;

export function suppressPopupCloseForClick(): void {
  suppressNextPopupClose = true;
  // Reset after current event loop so it only applies to this click.
  setTimeout(() => {
    suppressNextPopupClose = false;
  }, 0);
}

// Inject anchor CSS once — resets Leaflet divIcon defaults and ensures overflow is visible.
let cssInjected = false;
function ensureAnchorCSS() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent =
    ".project-popup-anchor{background:none!important;border:none!important;overflow:visible!important;pointer-events:none;}";
  document.head.appendChild(style);
}

function createAnchorMarker(latlng: L.LatLng): L.Marker {
  ensureAnchorCSS();
  if (!map.value.getPane("projectPopupPane")) {
    map.value.createPane("projectPopupPane").style.zIndex = "610";
  }
  return L.marker(latlng, {
    icon: L.divIcon({
      className: "project-popup-anchor",
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    }),
    interactive: false,
    keyboard: false,
    pane: "projectPopupPane",
  }).addTo(map.value);
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
 * Create teleport target for project info popup at marker position.
 * If a target already exists (switching markers), just moves the anchor.
 */
export function createProjectInfoTeleportTarget(marker: L.Marker) {
  const latlng = marker.getLatLng();

  if (anchorMarker) {
    // Anchor already exists — reposition it; the teleport stays mounted.
    anchorMarker.setLatLng(latlng);
    return;
  }

  anchorMarker = createAnchorMarker(latlng);
  setProjectPopupTarget((anchorMarker as any)._icon ?? null);
  attachClickHandler();
}

/**
 * Create teleport target for project info popup at a map position (e.g. shape click).
 * If a target already exists (switching projects), just moves the anchor.
 */
export function createProjectInfoTeleportTargetAtLatLng(latlng: L.LatLng) {
  if (anchorMarker) {
    anchorMarker.setLatLng(latlng);
    return;
  }

  anchorMarker = createAnchorMarker(latlng);
  setProjectPopupTarget((anchorMarker as any)._icon ?? null);
  attachClickHandler();
}

/**
 * Return the current popup anchor position.
 * Must be called before cleanupProjectInfoTeleportTarget() clears the state.
 */
export function getPopupLatLng(): { lat: number; lng: number } | null {
  const latlng = anchorMarker?.getLatLng();
  if (!latlng) return null;
  return { lat: latlng.lat, lng: latlng.lng };
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
