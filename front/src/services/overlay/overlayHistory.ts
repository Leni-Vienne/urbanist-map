// ============================================================================
// OVERLAY HISTORY - Corner state and edit mode cache management
// ============================================================================

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

  // Defensive guard: ensure history array exists (can be undefined if factory had a bug)
  if (!overlayObject.history) {
    overlayObject.history = [];
  }

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
 * Get corners for overlay based on priority: history > coordinates > default
 */
function getCornersForOverlay(overlayObject: OverlayObject) {
  // Priority 1: Use history if available (for undo/redo)
  if (overlayObject.history.length > 0) {
    const lastCorners = overlayObject.history.at(-1);
    if (lastCorners?.length === 4) return lastCorners;
  }

  // Priority 2: Use corners from overlayObject (skip if all-zero, which indicates a new overlay)
  if (
    overlayObject.corners.length === 4 &&
    !overlayObject.corners.every((c) => c.lat === 0 && c.lng === 0)
  ) {
    return overlayObject.corners;
  }

  // Priority 3: Initialize from current overlay state
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
 * Get corners for overlay with edit mode cache fallback
 * This function prioritizes edit mode cached modifications for position persistence
 */
export function getCornersForOverlayWithCache(overlayObject: OverlayObject) {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Check edit mode cache only if in edit mode
  // This ensures view mode always uses backend positions, not stale cached positions
  if (mapStore.mode === "edit") {
    const cachedModifications = overlayStore.getFromEditModeCache(overlayObject.id);
    if (cachedModifications?.corners.length === 4) {
      // Update object history with cached modifications
      overlayObject.history = [cachedModifications.corners];
      overlayObject.isModified = cachedModifications.isModified;
      return cachedModifications.corners;
    }
  }

  // Use backend corners (view mode or no cache available)
  return getCornersForOverlay(overlayObject);
}

/**
 * Save overlay modifications to edit mode cache for persistence across zoom changes
 * Also saves to pendingModificationsStore for unified modification tracking
 */
export function saveOverlayModificationsToCache(
  overlayObject: OverlayObject,
  forceMode?: "edit",
): void {
  const overlayStore = useOverlayStore();
  const pendingModsStore = usePendingModificationsStore();
  const mapStore = useMapStore();

  const layer = getLayer(overlayObject.id);
  if ((mapStore.mode !== "edit" && forceMode !== "edit") || !layer) return;
  const corners = layer.getCorners();
  if (!corners) return;

  const mappedCorners = corners.map((corner) => ({ lat: corner.lat, lng: corner.lng }));

  overlayStore.saveToEditModeCache(overlayObject.id, {
    corners: mappedCorners,
    isModified: overlayObject.isModified ?? false,
  });

  // Save to new unified store
  const overlayStatus = overlayObject.status ?? "pending";
  pendingModsStore.saveCornersChange(
    overlayObject.id,
    overlayObject.projectId ?? null,
    mappedCorners,
    overlayObject.corners, // Original corners from database
    overlayStatus,
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

  saveOverlayModificationsToCache(overlayObject);

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
