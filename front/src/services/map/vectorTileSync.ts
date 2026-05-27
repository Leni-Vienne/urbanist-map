/**
 * vectorTileSync.ts, idle-driven overlay sync for approved overlays.
 *
 * Listens to MapLibre's 'idle' event and diffs the rendered overlay-footprints
 * features against the overlay render registry to create/destroy Leaflet
 * DistortableImageOverlay instances for approved overlays.
 *
 * Runs in ALL modes (view, edit, moderation). Approved overlays are always
 * delivered via tiles, the bbox tRPC fetch only returns pending content.
 */

import { getMlMap, onMlMapReady } from "@/services/map/tileLayers";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { useMapStore } from "@/stores/pinia/mapStore";
import type { OverlayData } from "@/types/index";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { cornersIntersectBounds } from "@/utils/cornersBounds";

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

function syncOverlaysFromTiles(mlMap: any): void {
  // During style reloads/HMR, idle can fire before this layer is present.
  if (!mlMap.getLayer("overlay-footprints")) return;

  try {
    // querySourceFeatures (not queryRenderedFeatures) is used to also catch overlays whose
    // edges are outside the viewport (e.g. when zoomed in so far that only the interior shows).
    const allFeatures: any[] = mlMap.querySourceFeatures("project-sources", {
      sourceLayer: "overlay-footprints",
    });

    const bounds = mlMap.getBounds();
    const viewportBounds = {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    };

    // Deduplicate by ID (promoteId means the id may live on feat.id, not feat.properties.id).
    const featureMap = new Map<string, OverlayData>();
    for (const feat of allFeatures) {
      const id = String(feat.id ?? feat.properties?.id ?? "");

      if (!id || featureMap.has(id)) continue;

      const data = overlayDataFromFeature(feat);
      if (data && cornersIntersectBounds(data.corners, viewportBounds)) {
        featureMap.set(id, data);
      }
    }

    // Remove layers for approved overlays no longer in the rendered set.
    // Only evict registry entries that vectorTileSync itself created, identified by
    // presence in approvedOverlayDataCache. Pending layers (from bbox tRPC fetch) and
    // local/new layers are never in that cache, so they are never touched here.
    // Also skip entries currently being created, their in-flight async load will clean up
    // via the visibility check in onOverlayFullyLoaded if they've since left view.
    for (const id of registry.getRenderedOverlayIds()) {
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
    // View mode handles clicks via the overlay-footprints MapLibre layer, so no DOM pin.
    // Edit/moderation need a clickable status pin to select an approved overlay for editing.
    const toCreate = [...featureMap.values()];
    if (toCreate.length === 0) return;

    const createMarkers = useMapStore().mode !== "view";
    import("@/services/overlay/overlayRendering")
      .then(({ renderViewModeOverlays }) => {
        renderViewModeOverlays(toCreate, createMarkers);
      })
      .catch((error: unknown) =>
        console.error("vectorTileSync: failed to load overlayRendering", error),
      );
  } catch (error) {
    console.error("vectorTileSync idle error:", error);
  }
}

/**
 * Register the idle-driven overlay sync. Call once after map init.
 * Runs in all modes, approved overlays always come from tiles.
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
