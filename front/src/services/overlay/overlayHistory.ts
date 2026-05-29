import type { OverlayObject } from "@/types/index";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { updateMarkerTooltip } from "@/services/map/markers";
import { isValidQuad } from "@/services/overlay/overlayTransform";
import { getOverlayImageCorners } from "@/services/overlay/overlayImageLayer";

// Corners an overlay should render at, by priority: history > backend corners > live image.
// In view mode, approved overlays render at their backend corners but keep history, so edit
// mode can restore in-progress edits. (overlayMarkers' resolver prefers the live image first;
// both share isValidQuad.)
export function getCornersForOverlay(overlayObject: OverlayObject) {
  const mapStore = useMapStore();
  const ignoreHistory = mapStore.mode === "view" && overlayObject.status === "approved";

  if (!ignoreHistory && overlayObject.history.length > 0) {
    const lastCorners = overlayObject.history.at(-1);
    if (isValidQuad(lastCorners)) return lastCorners;
  }

  // Skip all-zero corners, which indicates a freshly created overlay with no position yet
  const stored = overlayObject.corners;
  const isUnplaced = stored.every((c) => c.lat === 0 && c.lng === 0);
  if (!isUnplaced && isValidQuad(stored)) return stored;

  return getOverlayImageCorners(overlayObject.id);
}

// Record the current image position as a change-request delta. No-op for new (status null)
// overlays, whose position lives only in history; only submitted overlays track a delta.
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

export function saveToHistory(overlayObject: OverlayObject): void {
  const currentState = getOverlayImageCorners(overlayObject.id);
  if (!currentState) return;

  // Seed empty history with the backend corners so the first undo has a base state.
  let baseHistory = overlayObject.history;
  if (baseHistory.length === 0 && overlayObject.corners.length === 4) {
    if (!overlayObject.corners.every((c) => c.lat === 0 && c.lng === 0)) {
      baseHistory = [overlayObject.corners.map((c) => ({ lat: c.lat, lng: c.lng }))];
    }
  }

  if (baseHistory.length > 0) {
    const lastState = baseHistory.at(-1);
    if (JSON.stringify(currentState) === JSON.stringify(lastState)) {
      return;
    }
  }

  // Build a fresh array rather than pushing: overlayObject may be a raw (non-proxied) object,
  // so an in-place mutation would not trigger Vue's reactive set trap.
  const newHistory = [...baseHistory, currentState.map((c) => ({ lat: c.lat, lng: c.lng }))];

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
