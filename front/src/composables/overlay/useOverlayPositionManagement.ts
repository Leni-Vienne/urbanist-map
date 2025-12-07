// AI : ============================================================================
// AI : OVERLAY POSITION MANAGEMENT - Unified position resolution, caching, and application
// AI : ============================================================================
// AI : Combines position resolution logic, edit mode caching, and Leaflet overlay updates
// AI : Single source of truth for all position-related operations
// AI : ============================================================================

import L from 'leaflet';
import { useOverlayStore } from '@/stores/pinia/overlayStore';
import { map } from '@/composables/core/useMap';
import { calculateCentroidFromCorners } from '@shared/overlayValidation';
import type { OverlayData, OverlayObject } from '@/types/index';
import type { MapMode } from '@shared/types';

// AI : ============================================================================
// AI : POSITION RESOLUTION
// AI : ============================================================================

/**
 * AI : Position source priority for different contexts
 */
export type PositionSource = 
  | 'runtime-overlay'      // Currently loaded overlay in memory
  | 'edit-mode-cache'      // Cached modifications from edit mode
  | 'backend-centroid'     // Original database centroid
  | 'backend-corners'      // Calculated from database corners
  | 'change-request';      // Temporary preview from change request

/**
 * AI : Result of position resolution with debugging info
 */
export interface ResolvedPosition {
  position: { lat: number; lng: number };
  source: PositionSource;
  corners?: { lat: number; lng: number }[];
}

/**
 * AI : Calculate position from corners
 */
function calculatePositionFromCorners(
  corners: { lat: number; lng: number }[],
  source: PositionSource
): ResolvedPosition | null {
  if (!corners || corners.length !== 4) {
    return null;
  }

  const calculatedPosition = calculateCentroidFromCorners(corners);
  if (calculatedPosition) {
    return {
      position: calculatedPosition,
      source,
      corners
    };
  }

  return null;
}

/**
 * AI : Resolve position for view/moderation mode (always backend data)
 */
function resolveViewModePosition(overlayData: OverlayData): ResolvedPosition {
  // AI : Try to calculate from corners first for accuracy
  const result = calculatePositionFromCorners(
    overlayData.corners,
    'backend-corners'
  );

  if (result) {
    return result;
  }

  // AI : Fallback to backend centroid
  return {
    position: { lat: overlayData.centroid.lat, lng: overlayData.centroid.lng },
    source: 'backend-centroid'
  };
}

/**
 * AI : Resolve position for edit mode (check runtime, cache, then backend)
 */
function resolveEditModePosition(
  overlayId: string,
  overlayData: OverlayData
): ResolvedPosition {
  const overlayStore = useOverlayStore();

  // AI : Priority 1: Currently loaded overlay (user might be actively editing)
  const overlayObject = overlayStore.overlays[overlayId];
  if (overlayObject?.corners?.length === 4) {
    const result = calculatePositionFromCorners(
      overlayObject.corners,
      'runtime-overlay'
    );
    if (result) return result;
  }

  // AI : Priority 2: Edit mode cache (persisted modifications from previous session)
  const cachedModifications = getFromEditModeOverlayCache(overlayId);
  if (cachedModifications?.corners?.length === 4) {
    const result = calculatePositionFromCorners(
      cachedModifications.corners,
      'edit-mode-cache'
    );
    if (result) return result;
  }

  // AI : Priority 3: Backend corners (calculate from database data)
  if (overlayData?.corners?.length === 4) {
    const result = calculatePositionFromCorners(
      overlayData.corners,
      'backend-corners'
    );
    if (result) return result;
  }

  // AI : Final fallback: Backend centroid
  return {
    position: { lat: overlayData.centroid.lat, lng: overlayData.centroid.lng },
    source: 'backend-centroid'
  };
}

/**
 * AI : Resolve overlay position based on current mode and state
 *
 * Priority chain:
 * - View/Moderation mode: Always use backend data (centroid or corners)
 * - Edit mode:
 *   1. Runtime overlay (if loaded in memory)
 *   2. Edit mode cache (if user previously modified)
 *   3. Backend data (default fallback)
 *
 * @param overlayId - ID of the overlay
 * @param overlayData - Backend overlay data (with centroid and corners)
 * @param mode - Current map mode
 * @param preview - Optional change request preview override
 * @returns Resolved position with source information
 */
export function resolveOverlayPosition(
  overlayId: string,
  overlayData: OverlayData,
  mode: MapMode,
  preview?: { type: 'current' | 'suggested'; corners: { lat: number; lng: number }[] }
): ResolvedPosition {
  // AI : Override for change request preview (highest priority)
  if (preview) {
    return {
      position: calculateCentroidFromCorners(preview.corners) ?? {
        lat: overlayData.centroid.lat,
        lng: overlayData.centroid.lng
      },
      source: 'change-request',
      corners: preview.corners
    };
  }

  // AI : View/Moderation mode: Always use backend data (no user modifications)
  if (mode === 'view' || mode === 'moderation') {
    return resolveViewModePosition(overlayData);
  }

  // AI : Edit mode: Check for user modifications
  return resolveEditModePosition(overlayId, overlayData);
}

// AI : ============================================================================
// AI : EDIT MODE CACHE
// AI : ============================================================================

// AI : Cache entry structure (matches what's in overlayStore)
export interface CachedPosition {
  corners: { lat: number; lng: number }[];
  isModified: boolean;
}

/**
 * AI : Save overlay modifications to edit mode cache
 *
 * @param overlayId - ID of the overlay
 * @param data - Corner coordinates and modification status
 */
export function saveToEditModeOverlayCache(
  overlayId: string,
  data: { corners: { lat: number, lng: number }[], isModified: boolean }
): void {
  const overlayStore = useOverlayStore();
  overlayStore.saveToEditModeCache(overlayId, data);
}

/**
 * AI : Get overlay modifications from edit mode cache
 *
 * @param overlayId - ID of the overlay
 * @returns Cached modifications or undefined
 */
export function getFromEditModeOverlayCache(
  overlayId: string
): { corners: { lat: number, lng: number }[], isModified: boolean } | undefined {
  const overlayStore = useOverlayStore();
  return overlayStore.getFromEditModeCache(overlayId);
}

// AI : ============================================================================
// AI : LEAFLET POSITION APPLICATION
// AI : ============================================================================

/**
 * AI : Get cached position for an overlay
 */
export function getCachedPosition(overlayId: string): CachedPosition | null {
  const overlayStore = useOverlayStore();
  const cached = overlayStore.getFromEditModeCache(overlayId);
  return cached ?? null;
}

/**
 * AI : Save overlay position to cache
 */
export function saveCachedPosition(overlayId: string, corners: { lat: number, lng: number }[], isModified: boolean): void {
  const overlayStore = useOverlayStore();

  const cacheData: CachedPosition = {
    corners: corners.map(corner => ({ lat: corner.lat, lng: corner.lng })),
    isModified,
  };

  overlayStore.saveToEditModeCache(overlayId, cacheData);
}

/**
 * AI : Save current position of an overlay object to cache
 */
export function cacheCurrentPosition(overlayObject: OverlayObject): void {
  if (!overlayObject.overlay) return;

  const corners = overlayObject.overlay.getCorners();
  saveCachedPosition(
    overlayObject.id,
    corners,
    overlayObject.isModified ?? false
  );
}

/**
 * AI : Apply cached or backend position to a single overlay
 * @param overlayObject - The overlay to update
 * @param useCache - If true, use cached position; if false, use backend position
 */
export function applyPositionToOverlay(overlayObject: OverlayObject, useCache: boolean): void {
  if (!overlayObject.overlay) {
    return;
  }

  // AI : Check if overlay is actually on the map before manipulating it
  // AI : This prevents "Cannot read properties of null (reading 'getPane')" errors
  if (!map.value || !map.value.hasLayer(overlayObject.overlay)) {
    console.warn('[applyPositionToOverlay] Overlay not on map yet, skipping position update for', overlayObject.id);
    return;
  }

  if (useCache) {
    // AI : Try to restore from cache first
    const cached = getCachedPosition(overlayObject.id);
    if (cached?.corners && cached.corners.length === 4) {
      const corners = cached.corners.map(c => L.latLng(c.lat, c.lng));
      overlayObject.overlay.setCorners(corners);
      overlayObject.isModified = cached.isModified;
      return;
    }
  }

  // AI : Fall back to backend positions (or if useCache is false)
  if (overlayObject.corners && overlayObject.corners.length === 4) {
    overlayObject.overlay.setCorners(overlayObject.corners);
    overlayObject.isModified = false;
  }
}

/**
 * AI : Apply positions to multiple overlays (batch operation)
 */
export function applyPositionsToOverlays(overlays: OverlayObject[], useCache: boolean): void {
  overlays.forEach(overlay => {
    applyPositionToOverlay(overlay, useCache);
  });
}
