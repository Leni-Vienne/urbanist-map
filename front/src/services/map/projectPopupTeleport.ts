// Shared teleport target management for project info popups
import type L from "leaflet";
import { map } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import { setProjectPopupTarget } from "@/services/map/popupState";

let currentMarkerForPopup: L.Marker | null = null;
let currentLatLngForPopup: L.LatLng | null = null;
let mapClickHandler: (() => void) | null = null;

/**
 * Update teleport target position based on current marker or latlng
 */
function updateTeleportTargetPosition() {
  const teleportTarget = document.querySelector<HTMLElement>("#project-info-popup-teleport-target");
  if (!teleportTarget) return;

  const latlng = currentMarkerForPopup?.getLatLng() ?? currentLatLngForPopup;
  if (!latlng) return;

  const point = map.value.latLngToContainerPoint(latlng);
  teleportTarget.style.left = `${point.x}px`;
  teleportTarget.style.top = `${point.y}px`;
}

/**
 * Create teleport target for project info popup at marker position
 */
export function createProjectInfoTeleportTarget(marker: L.Marker) {
  const markerLatLng = marker.getLatLng();
  const markerPoint = map.value.latLngToContainerPoint(markerLatLng);

  // Check if teleport target already exists (switching markers)
  let teleportTarget = document.querySelector<HTMLElement>("#project-info-popup-teleport-target");

  if (teleportTarget) {
    // Target exists, just update its position for the new marker
    teleportTarget.style.left = `${markerPoint.x}px`;
    teleportTarget.style.top = `${markerPoint.y}px`;
    currentMarkerForPopup = marker;
    return;
  }

  // No existing target, create a new one
  currentMarkerForPopup = marker;

  teleportTarget = document.createElement("div");
  teleportTarget.id = "project-info-popup-teleport-target";

  teleportTarget.style.cssText = `
    pointer-events: none;
    position: absolute;
    left: ${markerPoint.x}px;
    top: ${markerPoint.y}px;
    width: 0;
    height: 0;
    overflow: visible;
  `;

  const mapContainer = map.value.getContainer();
  mapContainer.appendChild(teleportTarget);

  // Set reactive state for PopupContainer
  setProjectPopupTarget(teleportTarget);

  map.value.on("move", updateTeleportTargetPosition);
  map.value.on("zoom", updateTeleportTargetPosition);
  map.value.on("resize", updateTeleportTargetPosition);

  mapClickHandler = () => {
    const uiStore = useUiStore();
    if (uiStore.projectInfoPopup.visible) {
      uiStore.closeProjectInfoPopup();
      cleanupProjectInfoTeleportTarget();
    }
  };
  map.value.on("click", mapClickHandler);
}

/**
 * Create teleport target for project info popup at a map position (e.g. shape click)
 */
export function createProjectInfoTeleportTargetAtLatLng(latlng: L.LatLng) {
  currentLatLngForPopup = latlng;
  currentMarkerForPopup = null;

  const point = map.value.latLngToContainerPoint(latlng);

  let teleportTarget = document.querySelector<HTMLElement>("#project-info-popup-teleport-target");
  if (teleportTarget) {
    teleportTarget.style.left = `${point.x}px`;
    teleportTarget.style.top = `${point.y}px`;
    return;
  }

  teleportTarget = document.createElement("div");
  teleportTarget.id = "project-info-popup-teleport-target";
  teleportTarget.style.cssText = `
    pointer-events: none;
    position: absolute;
    left: ${point.x}px;
    top: ${point.y}px;
    width: 0;
    height: 0;
    overflow: visible;
  `;

  const mapContainer = map.value.getContainer();
  mapContainer.appendChild(teleportTarget);
  setProjectPopupTarget(teleportTarget);

  map.value.on("move", updateTeleportTargetPosition);
  map.value.on("zoom", updateTeleportTargetPosition);
  map.value.on("resize", updateTeleportTargetPosition);

  mapClickHandler = () => {
    const uiStore = useUiStore();
    if (uiStore.projectInfoPopup.visible) {
      uiStore.closeProjectInfoPopup();
      cleanupProjectInfoTeleportTarget();
    }
  };
  map.value.on("click", mapClickHandler);
}

/**
 * Clean up teleport target and event listeners
 */
export function cleanupProjectInfoTeleportTarget() {
  map.value.off("move", updateTeleportTargetPosition);
  map.value.off("zoom", updateTeleportTargetPosition);
  map.value.off("resize", updateTeleportTargetPosition);

  if (mapClickHandler) {
    map.value.off("click", mapClickHandler);
    mapClickHandler = null;
  }

  const existingTarget = document.querySelector("#project-info-popup-teleport-target");
  if (existingTarget) {
    existingTarget.remove();
  }

  // Clear reactive state
  setProjectPopupTarget(null);

  currentMarkerForPopup = null;
  currentLatLngForPopup = null;
}
