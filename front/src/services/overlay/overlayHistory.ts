import type { OverlayObject } from "@/types/index";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import { getLayer } from "@/services/overlay/overlayRenderRegistry";

/**
 * Initialize history for overlay if not already set
 */
export function initializeOverlayHistory(overlayObject: OverlayObject): void {
  const layer = getLayer(overlayObject.id);
  if (!layer) return;

  if (overlayObject.history.length > 0) {
    return;
  }

  const initialCorners = layer.getCorners();
  if (initialCorners?.length === 4) {
    // eslint-disable-next-line prefer-structured-clone
    overlayObject.history = [JSON.parse(JSON.stringify(initialCorners))]; // structuredClone not used: corners are class instances
    overlayObject.redoStack = [];
  }
}

/**
 * Get corners for overlay based on priority: history > backend corners > layer fallback.
 * History.at(-1) is the single source of truth for the user's last edited position; it
 * survives layer pruning because it lives on the OverlayObject in the store.
 */
export function getCornersForOverlay(overlayObject: OverlayObject) {
  if (overlayObject.history.length > 0) {
    const lastCorners = overlayObject.history.at(-1);
    if (lastCorners?.length === 4) return lastCorners;
  }

  // Skip all-zero corners, which indicates a freshly created overlay with no position yet
  if (
    overlayObject.corners.length === 4 &&
    !overlayObject.corners.every((c) => c.lat === 0 && c.lng === 0)
  ) {
    return overlayObject.corners;
  }

  const currentCorners = getLayer(overlayObject.id)?.getCorners();
  if (currentCorners?.length === 4) {
    // eslint-disable-next-line prefer-structured-clone
    overlayObject.history = [JSON.parse(JSON.stringify(currentCorners))]; // structuredClone not used: corners are class instances
    overlayObject.redoStack = [];
    return currentCorners;
  }

  return null;
}

/**
 * Sync the change-request delta store with the current layer position.
 * For status === null overlays (new, not yet on the server), history alone holds the
 * position; no delta is tracked. For approved/pending/rejected overlays, we record the
 * current vs original corners so the change-request submission flow can read them.
 */
export function recordOverlayModification(overlayObject: OverlayObject, forceMode?: "edit"): void {
  const pendingModsStore = usePendingModificationsStore();
  const mapStore = useMapStore();

  const layer = getLayer(overlayObject.id);
  if ((mapStore.mode !== "edit" && forceMode !== "edit") || !layer) return;
  if (overlayObject.status === null) return;

  const corners = layer.getCorners();
  if (!corners) return;

  const mappedCorners = corners.map((corner) => ({ lat: corner.lat, lng: corner.lng }));

  pendingModsStore.saveCornersChange(
    overlayObject.id,
    overlayObject.projectId ?? null,
    mappedCorners,
    overlayObject.corners,
    overlayObject.status,
  );
}

/**
 * Save the current state of an overlay to history
 */
export function saveToHistory(overlayObject: OverlayObject): void {
  const layer = getLayer(overlayObject.id);
  if (!layer) return;

  const currentState = layer.getCorners();

  // Check if current state is different from last saved state
  if (overlayObject.history.length > 0) {
    const lastState = overlayObject.history.at(-1);
    const currentStateStr = JSON.stringify(currentState);
    const lastStateStr = JSON.stringify(lastState);

    if (currentStateStr === lastStateStr) {
      return;
    }
  }

  // Build new arrays before touching overlayObject.
  // overlayObject is the raw (non-proxied) object captured in Leaflet closures.
  // If we mutate overlayObject.history first, the Vue reactive proxy's set trap will see
  // target.history === newHistory (same reference) and skip the trigger entirely.
  // By calling updateOverlay first with a fresh array, Vue sees oldArray !== newArray → trigger.
  const newHistory = [
    ...overlayObject.history,
    structuredClone(currentState) as { lat: number; lng: number }[],
  ];

  overlayObject.isModified = true;

  recordOverlayModification(overlayObject);

  updateMarkerTooltip(overlayObject);

  // Update store with proper reactivity -- must happen before overlayObject.history is reassigned
  // (see comment above re: Vue set trap and same-reference skipping).
  const overlayStore = useOverlayStore();
  overlayStore.updateOverlay(overlayObject.id, {
    isModified: true,
    history: newHistory,
    redoStack: [],
  });

  // Sync raw object so non-reactive code paths see fresh state.
  overlayObject.history = newHistory;
  overlayObject.redoStack = [];
}
