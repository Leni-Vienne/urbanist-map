// AI : Unified overlay position resolver - single source of truth for position RESOLUTION
// AI : NOTE: This determines WHERE a position should come from (cache vs backend)
// AI : For APPLYING positions to Leaflet overlays, see useOverlayPositionCache.ts

import { useOverlayStore } from '@stores/pinia/overlayStore';
import { getFromEditModeOverlayCache } from './useOverlayEditCache';
import { calculateCenterFromCorners } from '../../utils/typeFactories';
import type { OverlayData, MapMode } from '@types';

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
  if (overlayObject && overlayObject.corners && overlayObject.corners.length === 4) {
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
