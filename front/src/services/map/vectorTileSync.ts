/**
 * vectorTileSync.ts — idle-driven overlay sync for view mode.
 *
 * Listens to MapLibre's 'idle' event and diffs the rendered overlay-footprints
 * features against the overlay render registry to create/destroy Leaflet
 * DistortableImageOverlay instances. Replaces pruneBackendOverlays in view mode.
 *
 * Only active while mode === 'view'. Edit/moderation use the bbox tRPC path.
 */

import { getMlMap, onMlMapReady } from "@/services/map/tileLayers";
import { useMapStore } from "@/stores/pinia/mapStore";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import type { OverlayData } from "@/types/index";

function overlayDataFromFeature(feat: any): OverlayData | null {
  const p = feat.properties;
  if (!p?.id || !p?.filename) return null;

  const corners = [
    { lat: Number(p.c0_lat), lng: Number(p.c0_lng) },
    { lat: Number(p.c1_lat), lng: Number(p.c1_lng) },
    { lat: Number(p.c2_lat), lng: Number(p.c2_lng) },
    { lat: Number(p.c3_lat), lng: Number(p.c3_lng) },
  ];

  if (corners.some((c) => isNaN(c.lat) || isNaN(c.lng))) return null;

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

function syncOverlaysFromTiles(mlMap: any): void {
  const mapStore = useMapStore();
  if (mapStore.mode !== "view") return;

  try {
    // Query features currently rendered in the overlay-footprints layer.
    // Pass options as the first (and only) argument — MapLibre detects the overloaded
    // signature by checking for a 'layers' key, so this queries the full viewport.
    // Do NOT pass undefined explicitly as geometry: MapLibre 5.x throws internally
    // when it tries to compute tile ranges from an undefined geometry value.
    // queryRenderedFeatures respects the layer's minzoom (14), so below zoom 14 this
    // returns an empty array and all layers are cleaned up — correct behaviour.
    const features: any[] = mlMap.queryRenderedFeatures({ layers: ["overlay-footprints"] } as any);

    // Deduplicate by ID — same overlay can appear in adjacent tiles
    const featureMap = new Map<string, OverlayData>();
    for (const feat of features) {
      const id = String(feat.properties?.id ?? "");
      if (id && !featureMap.has(id)) {
        const data = overlayDataFromFeature(feat);
        if (data) featureMap.set(id, data);
      }
    }

    // Remove layers for overlays no longer in the rendered set.
    // Skip entries currently being created — their in-flight async load will clean up
    // via the visibility check in onOverlayFullyLoaded if they've since left view.
    for (const [id] of registry.getAllLayers()) {
      if (!featureMap.has(id) && !registry.isCreating(id)) {
        registry.clearEntry(id);
      }
    }

    // Render new overlays. renderViewModeOverlays deduplicates via beginCreation inside.
    // createMarkers=false: click handling is done by the overlay-footprints MapLibre layer.
    const toCreate = [...featureMap.values()];
    if (toCreate.length === 0) return;

    void import("@/services/overlay/overlayRendering").then(({ renderViewModeOverlays }) => {
      renderViewModeOverlays(toCreate, false, false);
    });
  } catch (error) {
    console.error("vectorTileSync idle error:", error);
  }
}

/**
 * Register the idle-driven overlay sync. Call once after map init.
 * The handler only runs in view mode; other modes use the bbox tRPC path.
 */
export function initVectorTileSync(): void {
  onMlMapReady(() => {
    const mlMap = getMlMap();
    if (!mlMap) return;
    mlMap.on("idle", () => syncOverlaysFromTiles(mlMap));
  });
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
