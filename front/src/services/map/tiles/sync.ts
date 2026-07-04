/**
 * sync.ts, overlay sync for approved overlays.
 *
 * Diffs the rendered overlay-footprints features against the overlay render
 * registry to create/destroy overlay image layers for approved overlays.
 * Triggered on camera move and on footprint tiles loading (see initVectorTileSync).
 *
 * Runs in ALL modes (view, edit, moderation). Approved overlays are always
 * delivered via tiles, the bbox tRPC fetch only returns pending content.
 */

import { map, onMlMapReady } from "@/services/core/map";
import { throttle } from "@/utils/throttle";
import * as registry from "@/services/overlay/mapLayers";
import { useMapStore } from "@/stores/mapStore";
import type { OverlayData } from "@/types/index";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { cornersIntersectBounds } from "@/utils/cornersBounds";
import { getOverlayImageCorners } from "@/services/overlay/mapLayers";
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
  };
  return { overlay, lastModifiedS, timelineStatus, tags, name };
}

// eslint-disable-next-line complexity
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

    // Deduplicate by ID.
    const featureMap = new Map<string, OverlayData>();
    // Ids excluded by a client-side filter; the eviction pass drops these instead of keep-alive resurrecting them.
    const filtered = new Set<string>();
    const lastModifiedById = new Map<string, number>();
    const statusById = new Map<string, string | null>();
    const tagsById = new Map<string, string[]>();
    const nameById = new Map<string, string | null>();
    for (const feat of allFeatures) {
      const { overlay, lastModifiedS, timelineStatus, tags, name } = decodeFootprint(feat);
      if (!overlay || featureMap.has(overlay.id)) continue;
      const id = overlay.id;

      lastModifiedById.set(id, lastModifiedS);
      statusById.set(id, timelineStatus);
      tagsById.set(id, tags);
      nameById.set(id, name);

      if (
        !matchesDateFilter(lastModifiedS) ||
        !matchesTimelineStatusFilter(timelineStatus) ||
        !matchesSelectedTags(tags) ||
        !matchesNameFilter(name)
      ) {
        filtered.add(id);
        continue;
      }

      if (
        overlay.baselineCorners &&
        cornersIntersectBounds(overlay.baselineCorners, viewportBounds)
      ) {
        featureMap.set(id, overlay);
      }
    }

    // Remove layers for approved overlays no longer in the rendered set.
    // Only evict registry entries that this sync itself created, identified by
    // presence in approvedOverlayDataCache. Pending layers (from bbox tRPC fetch) and
    // local/new layers are never in that cache, so they are never touched here.
    // Also skip entries currently being created, their in-flight async load will clean up
    // via the visibility check in onOverlayFullyLoaded if they've since left view.
    for (const id of registry.getRenderedOverlayIds()) {
      if (!featureMap.has(id) && !registry.isCreating(id) && approvedOverlayDataCache.has(id)) {
        // Excluded by a client-side filter: remove it outright rather than keeping the image alive.
        if (filtered.has(id)) {
          registry.clearEntry(id);
          approvedOverlayDataCache.delete(id);
          continue;
        }
        const data = approvedOverlayDataCache.get(id);
        const liveCorners = getOverlayImageCorners(id);
        const effectiveCorners = liveCorners ?? data?.baselineCorners;

        if (effectiveCorners && cornersIntersectBounds(effectiveCorners, viewportBounds)) {
          // The overlay's backend coordinates are no longer in the MVT tiles for this viewport,
          // BUT its live edited image intersects the viewport. Keep it alive.
          if (data) featureMap.set(id, data);
        } else {
          registry.clearEntry(id);
          approvedOverlayDataCache.delete(id);
        }
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
    import("@/services/overlay/rendering")
      .then(({ renderViewModeOverlays }) => {
        // Re-check the live filters: this import is async, so toCreate may be stale.
        const stillVisible = toCreate.filter(
          (o) =>
            matchesDateFilter(lastModifiedById.get(o.id) ?? Number.NaN) &&
            matchesTimelineStatusFilter(statusById.get(o.id)) &&
            matchesSelectedTags(tagsById.get(o.id) ?? []) &&
            matchesNameFilter(nameById.get(o.id) ?? null),
        );
        if (stillVisible.length > 0) renderViewModeOverlays(stillVisible, createMarkers);
      })
      .catch((error: unknown) => console.error("sync: failed to load overlayRendering", error));
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
