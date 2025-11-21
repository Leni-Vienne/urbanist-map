// AI : ============================================================================
// AI : OVERLAY POSITION MANAGEMENT - Unified position resolution, caching, and application
// AI : ============================================================================
// AI : Combines position resolution logic, edit mode caching, and Leaflet overlay updates
// AI : Single source of truth for all position-related operations
// AI : ============================================================================

import L from 'leaflet';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { calculateCenterFromCorners } from '../../utils/typeFactories';
import type { OverlayData, OverlayObject, MapMode } from '@types';

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
      position: calculateCenterFromCorners(preview.corners) ?? { 
        lat: overlayData.centroid.lat, 
        lng: overlayData.centroid.lng 
      },
      source: 'change-request',
      corners: preview.corners
    };
  }

  // AI : View/Moderation mode: Always use backend data (no user modifications)
  if (mode === 'view' || mode === 'moderation') {
    // AI : Try to calculate from corners first for accuracy
    if (overlayData.corners && overlayData.corners.length === 4) {
      const calculatedPosition = calculateCenterFromCorners(overlayData.corners);
      if (calculatedPosition) {
        return {
          position: calculatedPosition,
          source: 'backend-corners',
          corners: overlayData.corners
        };
      }
    }
    
    // AI : Fallback to backend centroid
    return {
      position: { lat: overlayData.centroid.lat, lng: overlayData.centroid.lng },
      source: 'backend-centroid'
    };
  }

  // AI : Edit mode: Check for user modifications
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.overlays[overlayId];

  // AI : Priority 1: Currently loaded overlay (user might be actively editing)
  if (overlayObject?.corners?.length === 4) {
    const calculatedPosition = calculateCenterFromCorners(overlayObject.corners);
    if (calculatedPosition) {
      return {
        position: calculatedPosition,
        source: 'runtime-overlay',
        corners: overlayObject.corners
      };
    }
  }

  // AI : Priority 2: Edit mode cache (persisted modifications from previous session)
  const cachedModifications = getFromEditModeOverlayCache(overlayId);
  if (cachedModifications?.corners && cachedModifications.corners.length === 4) {
    const calculatedPosition = calculateCenterFromCorners(cachedModifications.corners);
    if (calculatedPosition) {
      return {
        position: calculatedPosition,
        source: 'edit-mode-cache',
        corners: cachedModifications.corners
      };
    }
  }

  // AI : Priority 3: Backend corners (calculate from database data)
  if (overlayData?.corners?.length === 4) {
    const calculatedPosition = calculateCenterFromCorners(overlayData.corners);
    if (calculatedPosition) {
      return {
        position: calculatedPosition,
        source: 'backend-corners',
        corners: overlayData.corners
      };
    }
  }

  // AI : Final fallback: Backend centroid
  return {
    position: { lat: overlayData.centroid.lat, lng: overlayData.centroid.lng },
    source: 'backend-centroid'
  };
}

/**
 * AI : Get marker color and position in one call (for marker rendering)
 * This is the main function to use when rendering overlay markers
 * 
 * @param overlayData - Backend overlay data
 * @param mode - Current map mode
 * @returns Position and color for marker rendering
 */
export function getOverlayMarkerInfo(
  overlayData: OverlayData,
  mode: MapMode
): { position: { lat: number; lng: number }; source: PositionSource } {
  const resolved = resolveOverlayPosition(
    overlayData.id,
    overlayData,
    mode
  );

  return {
    position: resolved.position,
    source: resolved.source
  };
}

/**
 * AI : Debug helper to explain position resolution
 * Useful for troubleshooting position issues
 */
export function explainPositionResolution(
  overlayId: string,
  overlayData: OverlayData,
  mode: MapMode
): string {
  const resolved = resolveOverlayPosition(overlayId, overlayData, mode);
  
  const sourceExplanations: Record<PositionSource, string> = {
    'runtime-overlay': 'Using position from currently loaded overlay (user may be editing)',
    'edit-mode-cache': 'Using cached position from previous edit session',
    'backend-centroid': 'Using original database centroid (default fallback)',
    'backend-corners': 'Calculated from database corner coordinates',
    'change-request': 'Showing preview position from change request'
  };

  return `Position resolved from: ${resolved.source}\n${sourceExplanations[resolved.source]}\nCoordinates: (${resolved.position.lat.toFixed(6)}, ${resolved.position.lng.toFixed(6)})`;
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
 * AI : Get overlay data with edit modifications applied (for edit mode)
 * This function checks if there are any edit mode modifications cached and applies them
 *
 * @param overlayData - Original overlay data from backend
 * @returns Overlay data with edit modifications applied if in edit mode
 */
export function getOverlayDataWithEditModifications(overlayData: OverlayData): OverlayData {
  const overlayStore = useOverlayStore();

  if (overlayStore.mode !== 'edit') {
    return overlayData;
  }

  const editModifications = overlayStore.getFromEditModeCache(overlayData.id);

  if (editModifications) {
    return {
      ...overlayData,
      corners: editModifications.corners,
      isModified: editModifications.isModified
    };
  }

  return overlayData;
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

/**
 * AI : Clear all edit mode cache
 */
export function clearEditModeOverlayCache(): void {
  const overlayStore = useOverlayStore();
  overlayStore.clearEditModeCache();
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
 * AI : Clear all cached positions
 */
export function clearAllCachedPositions(): void {
  const overlayStore = useOverlayStore();
  overlayStore.clearEditModeCache();
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
  const map = (overlayObject.overlay as any)._map;
  if (!map) {
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

/**
 * AI : Check if an overlay has cached position
 */
export function hasCachedPosition(overlayId: string): boolean {
  const cached = getCachedPosition(overlayId);
  return cached !== null && cached.corners.length === 4;
}
