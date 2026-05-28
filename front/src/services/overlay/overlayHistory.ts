import type { OverlayObject } from "@/types/index";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { updateMarkerTooltip } from "@/services/map/markers";
import { getOverlayImageCorners } from "@/services/overlay/overlayImageLayer";

/**
 * Initialize history for overlay if not already set
 */
export function initializeOverlayHistory(overlayObject: OverlayObject): void {
  if (overlayObject.history.length > 0) {
    return;
  }

  const initialCorners =
    getOverlayImageCorners(overlayObject.id) ??
    (overlayObject.corners.length === 4 ? overlayObject.corners : null);
  if (initialCorners?.length === 4) {
    overlayObject.history = [structuredClone(initialCorners) as { lat: number; lng: number }[]];
    overlayObject.redoStack = [];
  }
}

/**
 * Get corners for overlay based on priority: history > backend corners > live image position.
 * History.at(-1) is the single source of truth for the user's last edited position; it
 * survives layer pruning because it lives on the OverlayObject in the store.
 *
 * Exception: in view mode, approved overlays display at their authoritative backend position.
 * Their history is still preserved on the OverlayObject so re-entering edit mode restores the
 * user's in-progress edits.
 */
export function getCornersForOverlay(overlayObject: OverlayObject) {
  const mapStore = useMapStore();
  const ignoreHistory = mapStore.mode === "view" && overlayObject.status === "approved";

  if (!ignoreHistory && overlayObject.history.length > 0) {
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

  const currentCorners = getOverlayImageCorners(overlayObject.id);
  if (currentCorners?.length === 4) {
    overlayObject.history = [structuredClone(currentCorners) as { lat: number; lng: number }[]];
    overlayObject.redoStack = [];
    return currentCorners;
  }

  return null;
}

/**
 * Sync the change-request delta store with the current image position.
 * For status === null overlays (new, not yet on the server), history alone holds the
 * position; no delta is tracked. For approved/pending/rejected overlays, we record the
 * current vs original corners so the change-request submission flow can read them.
 */
export function recordOverlayModification(overlayObject: OverlayObject): void {
  const pendingModsStore = usePendingModificationsStore();
  const mapStore = useMapStore();

  if (mapStore.mode !== "edit") return;
  if (overlayObject.status === null) return;

  const corners = getOverlayImageCorners(overlayObject.id);
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
  const currentState = getOverlayImageCorners(overlayObject.id);
  if (!currentState) return;

  // Check if current state is different from last saved state
  if (overlayObject.history.length > 0) {
    const lastState = overlayObject.history.at(-1);
    const currentStateStr = JSON.stringify(currentState);
    const lastStateStr = JSON.stringify(lastState);

    if (currentStateStr === lastStateStr) {
      return;
    }
  }

  // Build the new array before touching overlayObject.history. overlayObject may be a raw
  // (non-proxied) object; mutating history first would make Vue's reactive set trap see the
  // same reference and skip the trigger. Calling updateOverlay with a fresh array first means
  // Vue sees oldArray !== newArray and fires.
  const newHistory = [
    ...overlayObject.history,
    structuredClone(currentState) as { lat: number; lng: number }[],
  ];

  overlayObject.isModified = true;

  recordOverlayModification(overlayObject);

  updateMarkerTooltip(overlayObject);

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
