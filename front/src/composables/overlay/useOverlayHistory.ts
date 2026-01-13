// AI : ============================================================================
// AI : OVERLAY HISTORY - Undo/Redo and history state management
// AI : ============================================================================
// AI : Extracted from useOverlay.ts to manage overlay position history
// AI : Provides undo/redo functionality and history state persistence
// AI : Note: Marker updates are handled by the caller after history operations
// AI : ============================================================================

import type { OverlayObject } from "@/types/index";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import {
  getFromEditModeOverlayCache,
  saveToEditModeOverlayCache,
} from "@/composables/overlay/useOverlayPositionManagement";
import { updateMarkerTooltip } from "@/composables/overlay/useOverlayMarkers";

/**
 * AI : Initialize history for overlay if not already set
 */
export function initializeOverlayHistory(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  // AI : Only initialize if history is completely empty
  if (overlayObject.history.length > 0) {
    return;
  }

  const initialCorners = overlayObject.overlay.getCorners();
  if (initialCorners?.length === 4) {
    // eslint-disable-next-line prefer-structured-clone
    overlayObject.history = [JSON.parse(JSON.stringify(initialCorners))]; // Can't use structuredClone because corners are a class instance
    overlayObject.redoStack = [];
  }
}

/**
 * AI : Get corners for overlay based on priority: history > coordinates > default
 */
export function getCornersForOverlay(overlayObject: OverlayObject) {
  // AI : Priority 1: Use history if available (for undo/redo)
  if (overlayObject.history?.length > 0) {
    const lastCorners = overlayObject.history.at(-1);
    if (lastCorners?.length === 4) return lastCorners;
  }

  // AI : Priority 2: Use corners from overlayObject (skip if all zeros - indicates new overlay)
  if (
    overlayObject.corners &&
    overlayObject.corners.length === 4 &&
    !overlayObject.corners.every((c) => c.lat === 0 && c.lng === 0)
  ) {
    return overlayObject.corners;
  }

  // AI : Priority 3: Initialize from current overlay state
  const currentCorners = overlayObject.overlay?.getCorners();
  if (currentCorners?.length === 4) {
    // eslint-disable-next-line prefer-structured-clone
    overlayObject.history = [JSON.parse(JSON.stringify(currentCorners))]; // Can't use structuredClone because corners are a class instance
    overlayObject.redoStack = [];
    return currentCorners;
  }

  return null;
}

/**
 * AI : Get corners for overlay with edit mode cache fallback
 * This function prioritizes edit mode cached modifications for position persistence
 */
export function getCornersForOverlayWithCache(overlayObject: OverlayObject) {
  const overlayStore = useOverlayStore();

  // AI : Check edit mode cache only if in edit mode
  // AI : This ensures view mode always uses backend positions, not stale cached positions
  if (overlayStore.mode === "edit") {
    const cachedModifications = getFromEditModeOverlayCache(overlayObject.id);
    if (cachedModifications?.corners?.length === 4) {
      // AI : Update object history with cached modifications
      overlayObject.history = [cachedModifications.corners];
      overlayObject.isModified = cachedModifications.isModified;
      return cachedModifications.corners;
    }
  }

  // AI : Use backend corners (view mode or no cache available)
  return getCornersForOverlay(overlayObject);
}

/**
 * AI : Validate corners data
 */
export function isValidCorners(corners: { lat: number; lng: number }[]): boolean {
  return corners.every(
    (corner) =>
      corner &&
      typeof corner.lat === "number" &&
      typeof corner.lng === "number" &&
      !Number.isNaN(corner.lat) &&
      !Number.isNaN(corner.lng),
  );
}

/**
 * AI : Save overlay modifications to edit mode cache for persistence across zoom changes
 * AI : Also saves to pendingModificationsStore for unified modification tracking
 */
export function saveOverlayModificationsToCache(overlayObject: OverlayObject): void {
  const overlayStore = useOverlayStore();
  const pendingModsStore = usePendingModificationsStore();

  if (overlayStore.mode !== "edit" || !overlayObject.overlay) return;
  const corners = overlayObject.overlay.getCorners();
  if (!corners?.length) return;

  const mappedCorners = corners.map((corner) => ({ lat: corner.lat, lng: corner.lng }));

  // AI : Save to old cache for backwards compatibility during migration
  saveToEditModeOverlayCache(overlayObject.id, {
    corners: mappedCorners,
    isModified: overlayObject.isModified ?? false,
  });

  // AI : Save to new unified store
  const overlayStatus = overlayObject.status ?? "pending";
  pendingModsStore.saveCornersChange(
    overlayObject.id,
    overlayObject.projectId ?? null,
    mappedCorners,
    overlayObject.corners ?? [], // Original corners from database
    overlayStatus,
  );
}

/**
 * AI : Save the current state of an overlay to history
 */
export function saveToHistory(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  const currentState = overlayObject.overlay.getCorners();
  if (!currentState?.length) return;

  // AI : Check if current state is different from last saved state
  if (overlayObject.history.length > 0) {
    const lastState = overlayObject.history[overlayObject.history.length - 1];
    const currentStateStr = JSON.stringify(currentState);
    const lastStateStr = JSON.stringify(lastState);

    if (currentStateStr === lastStateStr) {
      return;
    }
  }

  overlayObject.history.push(structuredClone(currentState) as { lat: number; lng: number }[]);
  overlayObject.redoStack = [];

  // AI : Mark overlay as modified when it's moved/changed
  overlayObject.isModified = true;

  // AI : Save modifications to edit mode cache if in edit mode for persistence across zoom changes
  saveOverlayModificationsToCache(overlayObject);

  updateMarkerTooltip(overlayObject);

  // AI : Update store with proper reactivity - critical for info popup to see changes
  const overlayStore = useOverlayStore();
  overlayStore.updateOverlay(overlayObject.id, {
    isModified: true,
    history: overlayObject.history,
    redoStack: overlayObject.redoStack,
  });
}
