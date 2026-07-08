/**
 * sync.ts, overlay sync for approved overlays.
 *
 * Reads the rendered overlay-footprints features, applies the client-side filters, and maintains
 * the approved-overlay cache (approvedOverlayCache.ts) with the approved overlays that should be on
 * the map for the current viewport. Creation and eviction of image layers is owned by the viewport
 * reconciler; this module only writes the cache and schedules a reconcile.
 * Triggered on camera move and on footprint tiles loading (see initVectorTileSync).
 *
 * Runs in ALL modes (view, edit, moderation). Approved overlays are always
 * delivered via tiles, the bbox tRPC fetch only returns pending content.
 */

import { map, onMlMapReady } from "@/services/core/map";
import { throttle } from "@/utils/throttle";
import { useOverlayStore } from "@/stores/overlayStore";
import type { OverlayData } from "@/types/index";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { cornersIntersectBounds } from "@/utils/cornersBounds";
import { resolveOverlayCorners } from "@/services/overlay/data";
import { runViewportRenderLoop } from "@/services/map/viewportRenderLoop";
import { replaceApprovedOverlayDataCache } from "@/services/map/tiles/approvedOverlayCache";
import {
  lastModifiedDateRange,
  matchesTimelineStatusFilter,
  matchesSelectedTags,
  matchesNameFilter,
} from "@/services/map/filters";

// lastModifiedS is Unix seconds (tile units). querySourceFeatures bypasses MapLibre layer
// filters, so images must be date-checked here rather than relying on setFilter.
function matchesDateFilter(lastModifiedS: number): boolean {
  const [minMs, maxMs] = lastModifiedDateRange.value;
  if (minMs === 0 && maxMs === Infinity) return true;
  if (!Number.isFinite(lastModifiedS)) return true;
  const ms = lastModifiedS * 1000;
  if (ms < minMs) return false;
  if (maxMs !== Infinity && ms > maxMs) return false;
  return true;
}

// A decoded overlay-footprint MVT feature: the OverlayData it maps to (null when the
// feature is not a renderable overlay), plus the transport-only fields the client-side
// filters need. lastModifiedS/timelineStatus are not overlay data, so they ride alongside
// rather than being forced onto OverlayData.
interface DecodedFootprint {
  overlay: OverlayData | null;
  lastModifiedS: number;
  timelineStatus: string | null;
  tags: string[];
  name: string | null;
}

function readString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

// Tiles carry `tags` as a JSON array string.
function readStringArray(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

// MapLibre types tile properties as an untyped `{ [name: string]: any }` bag, so values
// are normalized through `unknown` here rather than accessed ad hoc.
function decodeFootprint(feat: maplibregl.GeoJSONFeature): DecodedFootprint {
  const props: Record<string, unknown> = feat.properties;
  const lastModifiedS = Number(props.last_modified_s);
  const timelineStatus = readString(props.timeline_status);
  const tags = readStringArray(props.tags);
  const name = readString(props.name);

  // promoteId means the id may live on feat.id rather than properties.id.
  const id = String(feat.id ?? props.id ?? "");
  const filename = readString(props.filename);
  const corners = [
    { lat: Number(props.c0_lat), lng: Number(props.c0_lng) },
    { lat: Number(props.c1_lat), lng: Number(props.c1_lng) },
    { lat: Number(props.c2_lat), lng: Number(props.c2_lng) },
    { lat: Number(props.c3_lat), lng: Number(props.c3_lng) },
  ];

  if (!id || !filename || corners.some((c) => Number.isNaN(c.lat) || Number.isNaN(c.lng))) {
    return { overlay: null, lastModifiedS, timelineStatus, tags, name };
  }

  /* oxlint-disable-next-line no-non-null-assertion */
  const centroid = calculateCentroidFromCorners(corners)!;

  const overlay: OverlayData = {
    id,
    version: 1,
    filename,
    caption: readString(props.caption),
    status: "approved",
    projectId: readString(props.project_id),
    authorId: null,
    replacesOverlayId: null,
    replacedByOverlayId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    centroid,
    baselineCorners: corners,
    baselineCaption: readString(props.caption),
    source: "tile",
  };
  return { overlay, lastModifiedS, timelineStatus, tags, name };
}

export function syncOverlaysFromTiles(): void {
  const mlMap = map.value;
  // During style reloads/HMR, the layer can be absent when a listener fires.
  if (!mlMap.getLayer("overlay-footprints")) return;

  try {
    // querySourceFeatures (not queryRenderedFeatures) is used to also catch overlays whose
    // edges are outside the viewport (e.g. when zoomed in so far that only the interior shows).
    const allFeatures = mlMap.querySourceFeatures("project-sources", {
      sourceLayer: "overlay-footprints",
    });

    const bounds = mlMap.getBounds();
    const viewportBounds = {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    };

    const liveOverlays = useOverlayStore().liveOverlays;

    // Approved overlays that should be on the map for this viewport. Deduplicated by id.
    const featureMap = new Map<string, OverlayData>();
    // Ids seen this pass but dropped by a client-side filter, so a duplicate feature for the same
    // overlay is not re-tested.
    const filtered = new Set<string>();
    for (const feat of allFeatures) {
      const { overlay, lastModifiedS, timelineStatus, tags, name } = decodeFootprint(feat);
      if (!overlay || featureMap.has(overlay.id) || filtered.has(overlay.id)) continue;
      const id = overlay.id;

      if (
        !matchesDateFilter(lastModifiedS) ||
        !matchesTimelineStatusFilter(timelineStatus) ||
        !matchesSelectedTags(tags) ||
        !matchesNameFilter(name)
      ) {
        filtered.add(id);
        continue;
      }

      // Membership follows the position the image has (or would be created at), resolved from the
      // store object when one exists: its change-request/edit state can place the image away from
      // the tile footprint's baseline corners.
      const effectiveCorners = resolveOverlayCorners(liveOverlays[id] ?? overlay, "marker");
      if (effectiveCorners && cornersIntersectBounds(effectiveCorners, viewportBounds)) {
        featureMap.set(id, overlay);
      }
    }

    replaceApprovedOverlayDataCache(featureMap);

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
  onMlMapReady(() => {
    const mlMap = map.value;
    const runSync = throttle(syncOverlaysFromTiles, 150);

    mlMap.on("move", runSync);
    mlMap.on("sourcedata", (e) => {
      if (e.sourceId === "project-sources" && e.isSourceLoaded) runSync();
    });
    // Sync once now in case tiles loaded before the listeners registered.
    syncOverlaysFromTiles();
  });
}
