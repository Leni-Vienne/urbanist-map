// AI : ============================================================================
// AI : OVERLAY POSITION MANAGEMENT - Unified position resolution, caching, and application
// AI : ============================================================================
// AI : Combines position resolution logic, edit mode caching, and bounds calculation
// AI : Single source of truth for all position-related operations
// AI : ============================================================================

import L from "leaflet";

import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import type { OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";

// AI : ============================================================================
// AI : POSITION RESOLUTION
// AI : ============================================================================

/**
 * AI : Position source priority for different contexts
 */
type PositionSource =
  | "runtime-overlay" // Currently loaded overlay in memory
  | "edit-mode-cache" // Cached modifications from edit mode
  | "backend-centroid" // Original database centroid
  | "backend-corners" // Calculated from database corners
  | "change-request"; // Temporary preview from change request

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
  source: PositionSource,
): ResolvedPosition | null {
  if (!corners || corners.length !== 4) {
    return null;
  }

  const calculatedPosition = calculateCentroidFromCorners(corners);
  if (calculatedPosition) {
    return {
      position: calculatedPosition,
      source,
      corners,
    };
  }

  return null;
}

/**
 * AI : Resolve position for view/moderation mode (always backend data)
 */
function resolveViewModePosition(overlayData: OverlayData): ResolvedPosition {
  // AI : Try to calculate from corners first for accuracy
  const result = calculatePositionFromCorners(overlayData.corners, "backend-corners");

  if (result) {
    return result;
  }

  // AI : Fallback to backend centroid
  return {
    position: { lat: overlayData.centroid.lat, lng: overlayData.centroid.lng },
    source: "backend-centroid",
  };
}

/**
 * AI : Resolve position for edit mode (check runtime, cache, then backend)
 */
function resolveEditModePosition(overlayId: string, overlayData: OverlayData): ResolvedPosition {
  const overlayStore = useOverlayStore();

  //  AI : Priority 1: Currently loaded overlay (user might be actively editing)
  const overlayObject = overlayStore.overlays[overlayId];
  if (overlayObject?.overlay) {
    // AI : CRITICAL: Use actual Leaflet overlay corners, not overlayObject.corners
    // AI : overlayObject.corners contains original backend data, not moved positions
    const actualCorners = overlayObject.overlay.getCorners();
    if (actualCorners?.length === 4) {
      const corners = actualCorners.map((c) => ({ lat: c.lat, lng: c.lng }));
      const result = calculatePositionFromCorners(corners, "runtime-overlay");
      if (result) return result;
    }
  }

  // AI : Priority 2: Edit mode cache (persisted modifications from previous session)
  const cachedModifications = getFromEditModeOverlayCache(overlayId);
  if (cachedModifications?.corners?.length === 4) {
    const result = calculatePositionFromCorners(cachedModifications.corners, "edit-mode-cache");
    if (result) return result;
  }

  // AI : Priority 3: Backend corners (calculate from database data)
  if (overlayData?.corners?.length === 4) {
    const result = calculatePositionFromCorners(overlayData.corners, "backend-corners");
    if (result) return result;
  }

  // AI : Final fallback: Backend centroid
  return {
    position: { lat: overlayData.centroid.lat, lng: overlayData.centroid.lng },
    source: "backend-centroid",
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
  mode: AppMode,
  preview?: { type: "current" | "suggested"; corners: { lat: number; lng: number }[] },
): ResolvedPosition {
  // AI : Override for change request preview (highest priority)
  if (preview) {
    return {
      position: calculateCentroidFromCorners(preview.corners) ?? {
        lat: overlayData.centroid.lat,
        lng: overlayData.centroid.lng,
      },
      source: "change-request",
      corners: preview.corners,
    };
  }

  // AI : View/Moderation mode: Always use backend data (no user modifications)
  if (mode === "view" || mode === "moderation") {
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
  data: { corners: { lat: number; lng: number }[]; isModified: boolean },
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
  overlayId: string,
): { corners: { lat: number; lng: number }[]; isModified: boolean } | undefined {
  const overlayStore = useOverlayStore();
  return overlayStore.getFromEditModeCache(overlayId);
}

// AI : ============================================================================
// AI : LEAFLET POSITION APPLICATION
// AI : ============================================================================

/**
 * AI : Save overlay position to cache
 */
export function saveCachedPosition(
  overlayId: string,
  corners: { lat: number; lng: number }[],
  isModified: boolean,
): void {
  const overlayStore = useOverlayStore();

  const cacheData: CachedPosition = {
    corners: corners.map((corner) => ({ lat: corner.lat, lng: corner.lng })),
    isModified,
  };

  overlayStore.saveToEditModeCache(overlayId, cacheData);
}

/**
 * AI : Get bounds for an overlay (for camera navigation)
 * AI : Moved from overlayMarkers.ts to centralize position logic
 */
export function getOverlayBounds(overlay: OverlayData): L.LatLngBounds | null {
  const overlayStore = useOverlayStore();

  // AI : Priority 0: If overlay is rendered, use actual Leaflet overlay position (most accurate)
  // AI : Type guard to check if overlay property exists on the object
  // AI : Cast to any to access Leaflet methods if type definition is incomplete
  if ("overlay" in overlay && overlay.overlay) {
    const actualCorners = (overlay.overlay as any).getCorners();
    if (actualCorners?.length === 4) {
      return L.latLngBounds(actualCorners);
    }
  }

  // AI : Priority 1: Check edit mode cache if in edit mode for the most current position
  if (overlayStore.mode === "edit") {
    const cachedModifications = getFromEditModeOverlayCache(overlay.id);
    if (cachedModifications?.corners?.length === 4) {
      const corners = cachedModifications.corners.map((corner) => L.latLng(corner.lat, corner.lng));
      return L.latLngBounds(corners);
    }
  }

  // AI : Priority 2: Use overlay corners from overlayData
  // AI : (OverlayData always has corners, typically approved position)
  if (overlay.corners?.length === 4) {
    const corners = overlay.corners.map((corner) => L.latLng(corner.lat, corner.lng));
    return L.latLngBounds(corners);
  }

  return null;
}
