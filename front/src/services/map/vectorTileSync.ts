/**
 * vectorTileSync.ts — idle-driven overlay sync for approved overlays.
 *
 * Listens to MapLibre's 'idle' event and diffs the rendered overlay-footprints
 * features against the overlay render registry to create/destroy Leaflet
 * DistortableImageOverlay instances for approved overlays.
 *
 * Runs in ALL modes (view, edit, moderation). Approved overlays are always
 * delivered via tiles — the bbox tRPC fetch only returns pending content.
 */

import { getMlMap, onMlMapReady } from "@/services/map/tileLayers";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import type { OverlayData } from "@/types/index";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";

// ── Approved overlay data cache ───────────────────────────────────────────────
// Stores the last-synced set of OverlayData objects built from tile features.
// Used by viewportRenderLoop to collect approved overlay project IDs for shape
// rendering in edit/moderation mode (where viewModeOverlays only has pending content).
const approvedOverlayDataCache = new Map<string, OverlayData>();

/**
 * Returns the current snapshot of approved overlay data built from tile features.
 * Only includes overlays whose ids are currently in the rendered overlay-footprints layer.
 */
export function getApprovedOverlayDataFromTiles(): ReadonlyMap<string, OverlayData> {
  return approvedOverlayDataCache;
}

// ─────────────────────────────────────────────────────────────────────────────

function overlayDataFromFeature(feat: any): OverlayData | null {
  const p = feat.properties;
  if (!p?.id || !p?.filename) return null;

  const corners = [
    { lat: Number(p.c0_lat), lng: Number(p.c0_lng) },
    { lat: Number(p.c1_lat), lng: Number(p.c1_lng) },
    { lat: Number(p.c2_lat), lng: Number(p.c2_lng) },
    { lat: Number(p.c3_lat), lng: Number(p.c3_lng) },
  ];

  if (corners.some((c) => Number.isNaN(c.lat) || Number.isNaN(c.lng))) return null;

  /* oxlint-disable-next-line no-non-null-assertion */
  const centroid = calculateCentroidFromCorners(corners)!;

  return {
    id: String(p.id),
    version: 1,
    filename: String(p.filename),
    caption: p.caption ?? null,
    status: "approved",
    projectId: p.project_id ? String(p.project_id) : null,
    authorId: null,
    replacesOverlayId: null,
    replacedByOverlayId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    centroid,
    corners,
  };
}

/* function used to prevent overlays from being pruned when the viewport is entirely covered by an overlay polygon. */
function overlayIntersectsViewport(
  corners: { lat: number; lng: number }[],
  bounds: { north: number; south: number; east: number; west: number },
): boolean {
  /* oxlint-disable-next-line no-non-null-assertion */
  const firstCorner = corners[0]!;
  let minLat = firstCorner.lat;
  let maxLat = firstCorner.lat;
  let minLng = firstCorner.lng;
  let maxLng = firstCorner.lng;

  for (let i = 1; i < corners.length; i += 1) {
    /* oxlint-disable-next-line no-non-null-assertion */
    const c = corners[i]!;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
  }

  // AABB intersection test - correctly handles viewport inside overlay
  return (
    maxLat > bounds.south && minLat < bounds.north && maxLng > bounds.west && minLng < bounds.east
  );
}

function syncOverlaysFromTiles(mlMap: any): void {
  // During style reloads/HMR, idle can fire before this layer is present.
  if (!mlMap.getLayer("overlay-footprints")) return;

  try {
    // Use querySourceFeatures instead of queryRenderedFeatures to avoid the viewport issue.
    // queryRenderedFeatures only returns features with visible geometry in the viewport,
    // which fails when zoomed in so close that all overlay edges are outside the screen.
    // querySourceFeatures queries the tile data directly based on the source layer,
    // returning all features in loaded tiles regardless of visual rendering.
    // This correctly handles the case where viewport is entirely inside an overlay polygon.
    const allFeatures: any[] = mlMap.querySourceFeatures("project-sources", {
      sourceLayer: "overlay-footprints",
    });

    // Get viewport bounds to filter features
    const bounds = mlMap.getBounds();
    const viewportBounds = {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    };

    // Deduplicate by ID and filter by viewport intersection.
    // With promoteId set on the source, the id may be on feat.id rather than feat.properties.id.
    const featureMap = new Map<string, OverlayData>();
    for (const feat of allFeatures) {
      const id = String(feat.id ?? feat.properties?.id ?? "");

      if (!id || featureMap.has(id)) continue;

      const data = overlayDataFromFeature(feat);
      if (data && overlayIntersectsViewport(data.corners, viewportBounds)) {
        // Only include if it intersects the viewport
        featureMap.set(id, data);
      }
    }

    // Remove layers for approved overlays no longer in the rendered set.
    // Only evict registry entries that vectorTileSync itself created — identified by
    // presence in approvedOverlayDataCache. Pending layers (from bbox tRPC fetch) and
    // local/new layers are never in that cache, so they are never touched here.
    // Also skip entries currently being created — their in-flight async load will clean up
    // via the visibility check in onOverlayFullyLoaded if they've since left view.
    for (const [id] of registry.getAllLayers()) {
      if (!featureMap.has(id) && !registry.isCreating(id) && approvedOverlayDataCache.has(id)) {
        registry.clearEntry(id);
        approvedOverlayDataCache.delete(id);
      }
    }

    // Sync the approved overlay data cache with the current feature set.
    // Evict entries no longer in view, add new ones.
    for (const [id, data] of featureMap) {
      approvedOverlayDataCache.set(id, data);
    }
    // Also evict cache entries for IDs that are not in featureMap at all
    // (covers the case where an entry is in cache but not in the registry).
    for (const id of approvedOverlayDataCache.keys()) {
      if (!featureMap.has(id)) {
        approvedOverlayDataCache.delete(id);
      }
    }

    // Render new overlays. renderViewModeOverlays deduplicates via beginCreation inside.
    // createMarkers=false: click handling is done by the overlay-footprints MapLibre layer.
    const toCreate = [...featureMap.values()];
    if (toCreate.length === 0) return;

    import("@/services/overlay/overlayRendering")
      .then(({ renderViewModeOverlays }) => {
        renderViewModeOverlays(toCreate, false, false);
      })
      .catch((error) => console.error("vectorTileSync: failed to load overlayRendering", error));
  } catch (error) {
    console.error("vectorTileSync idle error:", error);
  }
}

/**
 * Register the idle-driven overlay sync. Call once after map init.
 * Runs in all modes — approved overlays always come from tiles.
 */
export function initVectorTileSync(): void {
  onMlMapReady(() => {
    const mlMap = getMlMap();
    if (!mlMap) return;
    mlMap.on("idle", () => syncOverlaysFromTiles(mlMap));
    // Sync immediately in case the map is already idle (tiles loaded before listener registered)
    syncOverlaysFromTiles(mlMap);
  });
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
