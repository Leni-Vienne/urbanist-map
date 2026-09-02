/**
 * sync.ts, overlay sync for approved overlays.
 *
 * Reads overlay-footprint tile features, applies project filters, and maintains
 * the current tile projection set with the approved overlays that should be on the map for the
 * current viewport. Creation and eviction of image layers is owned by the viewport reconciler.
 * Triggered on camera move and on footprint tiles loading (see initVectorTileSync).
 *
 * Runs in ALL modes (view, edit, moderation). Approved overlays are always
 * delivered via tiles, while session endpoints provide complete backend snapshots.
 */

import type * as maplibregl from "maplibre-gl";
import { getMapOrNull, onMapReady } from "@/services/core/map";
import { throttle } from "@/utils/throttle";
import { useOverlayStore } from "@/stores/overlayStore";
import type { TileOverlayData, TileProperties } from "@/types/index";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { runViewportRenderLoop } from "@/services/map/viewportRenderLoop";
import { matchesProjectFilters, type FilterableProject } from "@/services/core/filters";

interface DecodedFootprint {
  overlay: TileOverlayData | null;
  project: FilterableProject;
}

function readString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function hasInvalidCorner(corner: { lat: number; lng: number }): boolean {
  return Number.isNaN(corner.lat) || Number.isNaN(corner.lng);
}

// MapLibre types tile properties as an untyped `{ [name: string]: any }` bag, so values
// are normalized through `unknown` here rather than accessed ad hoc.
function decodeFootprint(feat: maplibregl.GeoJSONFeature): DecodedFootprint {
  const props: TileProperties = feat.properties;
  const project: FilterableProject = {
    tags: readStringArray(props.tags),
    timelineStatus: readString(props.timeline_status),
    name: readString(props.name),
    geometrySizeM: props.geometry_size_m === null ? null : Number(props.geometry_size_m),
    lastModifiedMs: Number(props.last_modified_s) * 1000,
    hasImage: true,
  };
  const id = String(feat.id ?? props.id ?? "");
  const filename = readString(props.filename);
  const corners = [
    { lat: Number(props.c0_lat), lng: Number(props.c0_lng) },
    { lat: Number(props.c1_lat), lng: Number(props.c1_lng) },
    { lat: Number(props.c2_lat), lng: Number(props.c2_lng) },
    { lat: Number(props.c3_lat), lng: Number(props.c3_lng) },
  ];

  if (!id || !filename || corners.some(hasInvalidCorner)) {
    return { overlay: null, project };
  }

  /* oxlint-disable-next-line no-non-null-assertion */
  const centroid = calculateCentroidFromCorners(corners)!;
  const caption = readString(props.caption);
  return {
    project,
    overlay: {
      id,
      filename,
      caption,
      status: "approved",
      projectId: readString(props.project_id),
      centroid,
      baselineCorners: corners,
      baselineCaption: caption,
    },
  };
}

function readStringArray(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isString) : [];
  } catch {
    return [];
  }
}

export function syncOverlaysFromTiles(): void {
  const mlMap = getMapOrNull();
  // During style reloads, the layer can be absent when a listener fires.
  if (!mlMap?.getLayer("overlay-footprints")) return;

  try {
    // Source queries cover MapLibre's renderable in-view tiles and include features independently
    // of their style visibility.
    const allFeatures = mlMap.querySourceFeatures("project-sources", {
      sourceLayer: "overlay-footprints",
    });

    // Approved overlays represented by the current renderable tile set. Deduplicated by id.
    const featureMap = new Map<string, TileOverlayData>();
    for (const feat of allFeatures) {
      const { overlay, project } = decodeFootprint(feat);
      if (!overlay || featureMap.has(overlay.id) || !matchesProjectFilters(project)) continue;
      featureMap.set(overlay.id, overlay);
    }

    useOverlayStore().replaceTileOverlays(featureMap);

    // Creation and eviction from the cache is owned by the reconciler; just schedule it.
    runViewportRenderLoop();
  } catch (error) {
    console.error("sync error:", error);
  }
}

/**
 * Register the overlay sync. Call once after map init.
 * Runs in all modes, approved overlays always come from tiles.
 *
 * Both map-event triggers share one throttle so they run periodically DURING movement (images
 * appear as you pan, not only once the camera stops) while capping the querySourceFeatures rate.
 * The throttle runs on the leading edge and then at most once per interval, with a trailing run
 * so the final state is always synced:
 * - `move`: any camera change, from a gesture or a programmatic flyTo/jumpTo.
 * - `sourcedata` on project-sources: footprint tiles finished loading, so new features may be
 *   available at the current viewport.
 *
 * `idle` is intentionally NOT used: it fires after every repaint, including the in-place repaints
 * from hover feature-state, so it would call the sync on plain cursor movement.
 */
export function initVectorTileSync(): void {
  onMapReady((mlMap) => {
    const runSync = throttle(syncOverlaysFromTiles, 150);

    mlMap.on("move", runSync);
    mlMap.on("sourcedata", (e) => {
      if (e.sourceId === "project-sources" && e.isSourceLoaded) runSync();
    });
    // Sync once now in case tiles loaded before the listeners registered.
    syncOverlaysFromTiles();
  });
}
