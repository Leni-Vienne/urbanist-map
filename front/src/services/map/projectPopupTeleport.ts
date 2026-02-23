// AI : Shared teleport target management for project info popups
import type L from "leaflet";
import { map } from "@/services/core/map";
import { useUiStore } from "@/stores/uiStore";
import { setProjectPopupTarget } from "@/services/map/popupState";

let currentMarkerForPopup: L.Marker | null = null;
let mapClickHandler: (() => void) | null = null;

/**
 * AI : Update teleport target position based on current marker
 */
function updateTeleportTargetPosition() {
  if (!currentMarkerForPopup) return;

  const teleportTarget = document.querySelector<HTMLElement>("#project-info-popup-teleport-target");
  if (!teleportTarget) return;

  const markerLatLng = currentMarkerForPopup.getLatLng();
  const markerPoint = map.value.latLngToContainerPoint(markerLatLng);

  teleportTarget.style.left = `${markerPoint.x}px`;
  teleportTarget.style.top = `${markerPoint.y}px`;
}

/**
 * AI : Create teleport target for project info popup at marker position
 */
export function createProjectInfoTeleportTarget(marker: L.Marker) {
  const markerLatLng = marker.getLatLng();
  const markerPoint = map.value.latLngToContainerPoint(markerLatLng);

  // AI : Check if teleport target already exists (switching markers)
  let teleportTarget = document.querySelector<HTMLElement>("#project-info-popup-teleport-target");

  if (teleportTarget) {
    // AI : Target exists, just update its position for the new marker
    teleportTarget.style.left = `${markerPoint.x}px`;
    teleportTarget.style.top = `${markerPoint.y}px`;
    currentMarkerForPopup = marker;
    return;
  }

  // AI : No existing target, create a new one
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

  // AI : Set reactive state for PopupContainer
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
 * AI : Clean up teleport target and event listeners
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

  // AI : Clear reactive state
  setProjectPopupTarget(null);

  currentMarkerForPopup = null;
}
