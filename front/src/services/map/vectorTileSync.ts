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

  const centroid = {
    lat: (corners[0]!.lat + corners[1]!.lat + corners[2]!.lat + corners[3]!.lat) / 4,
    lng: (corners[0]!.lng + corners[1]!.lng + corners[2]!.lng + corners[3]!.lng) / 4,
  };

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

// All overlay-footprint line layer IDs that carry overlay features.
// Each layer has an exclusive filter (completed / proposed / neither) so all three
// must be queried together to get the full set of approved overlays in view.
const OVERLAY_FOOTPRINT_LAYERS = [
  "overlay-footprints",
  "overlay-footprints-completed",
  "overlay-footprints-proposed-dashed",
] as const;

function syncOverlaysFromTiles(mlMap: any): void {
  // During style reloads/HMR, idle can fire before this layer is present.
  if (!mlMap.getLayer("overlay-footprints")) return;

  try {
    // Query features currently rendered in the overlay-footprints layers.
    // Must pass a geometry (viewport bbox in screen pixels) as the first argument.
    // Passing options as the first argument silently returns 0 features in MapLibre 5.x —
    // it interprets the options object as a geometry and finds nothing.
    // All three sub-layers are queried because each has an exclusive status filter:
    //   overlay-footprints              → neither completed nor proposed
    //   overlay-footprints-completed    → completed
    //   overlay-footprints-proposed-dashed → proposed
    // queryRenderedFeatures respects each layer's minzoom (13 MapLibre = Leaflet zoom 14 =
    // MIN_ZOOM_FOR_OVERLAYS), so below that threshold this returns an empty array and all
    // approved layers are cleaned up — correct behaviour.
    const canvas = mlMap.getCanvas();
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    const viewportBbox: [[number, number], [number, number]] = [
      [0, 0],
      [w, h],
    ];
    const features: any[] = mlMap.queryRenderedFeatures(viewportBbox, {
      layers: [...OVERLAY_FOOTPRINT_LAYERS],
    });

    // Deduplicate by ID — same overlay can appear in adjacent tiles.
    // With promoteId set on the source, the id may be on feat.id rather than feat.properties.id.
    const featureMap = new Map<string, OverlayData>();
    for (const feat of features) {
      const id = String(feat.id ?? feat.properties?.id ?? "");
      if (id && !featureMap.has(id)) {
        const data = overlayDataFromFeature(feat);
        if (data) featureMap.set(id, data);
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
