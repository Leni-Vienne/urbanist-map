import { ref, computed, watch, onUnmounted, onActivated, onDeactivated } from "vue";
import { LngLatBounds } from "maplibre-gl";
import type * as maplibregl from "maplibre-gl";
import { highlightProject, removeProjectOutlines } from "@/services/overlay/projectHighlight";
import { setExternalHover } from "@/services/map/vectorHoverState";
import { map, onMlMapReady } from "@/services/core/map";
import { handleProjectClickFromTile } from "@/services/map/projectSelection";
import { VECTOR_QUERY_LAYERS } from "@/services/map/projectQueryLayers";
import { useUiStore } from "@/stores/uiStore";
import { flyToGeometry } from "@/services/map/mapNavigation";
import { lastModifiedDateRange, sizeFilterRange } from "@/services/map/filters";
import { forEachPosition } from "@/utils/geojson";
import { triggerProjectHover, clearHoverPreview } from "@/services/map/hoverPreviewState";

export type SortMode = "recent" | "name" | "size" | "status";

interface VisibleProject {
  id: string;
  name: string | null;
  /** Actual geometry bbox from the MVT feature, used for zooming. Null for standalone points. */
  bbox: LngLatBounds | null;
  /** Middle vertex of the clipped tile geometry, guaranteed on the drawn line, used as the map anchor. */
  midLat: number | null;
  midLng: number | null;
  firstTag: string;
  /** All tags for the project, parsed from the MVT JSON-encoded array property. */
  tags: string[];
  timelineStatus: string;
  lastModifiedS: number;
  sizeM: number;
  lat: number | null;
  lng: number | null;
  bottomLat: number | null;
  bottomLng: number | null;
}

const STATUS_RANK: Record<string, number> = {
  proposed: 0,
  planned: 1,
  under_construction: 2,
  completed: 3,
  canceled: 4,
};

// All MapLibre layer IDs that can contain project features.
// VECTOR_QUERY_LAYERS covers all project-shapes and overlay-footprints sub-layers
// (split by status because MapLibre line-dasharray can't be data-driven).
// "project-points" is added separately as it lives in a different source.
// "pending-project-points" is intentionally excluded (unapproved, not shown in panel).
const QUERY_LAYERS = ["project-points", ...VECTOR_QUERY_LAYERS] as const;

function collectCoords(geom: GeoJSON.Geometry): number[][] {
  const out: number[][] = [];
  forEachPosition(geom, (lng, lat) => out.push([lng, lat]));
  return out;
}

function projectsChanged(prev: VisibleProject[], next: VisibleProject[]): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < next.length; i += 1) {
    //oxlint-disable-next-line no-non-null-assertion
    const p = prev[i]!;
    //oxlint-disable-next-line no-non-null-assertion
    const n = next[i]!;
    if (
      p.id !== n.id ||
      p.name !== n.name ||
      p.timelineStatus !== n.timelineStatus ||
      p.lastModifiedS !== n.lastModifiedS ||
      Math.round(p.sizeM) !== Math.round(n.sizeM)
    )
      return true;
  }
  return false;
}

/** Tags are encoded as JSON strings in the SQL via array_to_json()::text; parse them back here. */
function parseMvtTags(raw: unknown): string[] {
  try {
    if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string");
    return JSON.parse(typeof raw === "string" ? raw : "[]") as string[];
  } catch {
    return [];
  }
}

/** Parse a single MVT feature into a VisibleProject entry. */
function featureToProject(
  f: maplibregl.MapGeoJSONFeature,
  centerLat: number,
  centerLng: number,
): VisibleProject | null {
  const props = f.properties;
  const sourceLayer = String(f.sourceLayer);
  const id = sourceLayer === "overlay-footprints" ? (props.project_id ?? "") : (props.id ?? "");
  if (!id) return null;
  const name: string | null = props.name ?? null;
  // oxlint-disable-next-line no-unsafe-type-assertion
  const geom = f.geometry as GeoJSON.Geometry | null;
  const [bboxLng, bboxLat, bbox, bottomLat, bottomLng] = getGeomBbox(geom);
  const [midLat, midLng] = getGeomClosestToCenter(geom, centerLat, centerLng);
  // popup_lat/popup_lng are ST_PointOnSurface of the full unclipped geometry, used as fallback
  // for standalone points that have no clipped geometry midpoint.
  const lat =
    props.popup_lat !== null && props.popup_lat !== undefined ? Number(props.popup_lat) : bboxLat;
  const lng =
    props.popup_lng !== null && props.popup_lng !== undefined ? Number(props.popup_lng) : bboxLng;
  const rawSize = props.geometry_size_m ?? props.max_size_m;
  return {
    id,
    name,
    bbox,
    firstTag: props.first_tag ?? "",
    tags: parseMvtTags(props.tags),
    timelineStatus: props.timeline_status ?? "",
    lastModifiedS:
      props.last_modified_s !== null && props.last_modified_s !== undefined
        ? Number(props.last_modified_s)
        : 0,
    sizeM: rawSize !== null && rawSize !== undefined ? Number(rawSize) : 0,
    lat,
    lng,
    midLat,
    midLng,
    bottomLat,
    bottomLng,
  };
}

/** Merge a subsequent feature for the same project id into the existing entry. */
function mergeIntoExisting(existing: VisibleProject, incoming: VisibleProject): void {
  if (incoming.name && !existing.name) existing.name = incoming.name;
  if (incoming.lat !== null && existing.lat === null) {
    existing.lat = incoming.lat;
    existing.lng = incoming.lng;
  }
  // Use Math.max to guarantee we always capture the real size and date from whichever layer
  // provides it (project geometry vs overlay footprint), regardless of feature arrival order.
  existing.sizeM = Math.max(existing.sizeM || 0, incoming.sizeM || 0);
  existing.lastModifiedS = Math.max(existing.lastModifiedS || 0, incoming.lastModifiedS || 0);
  if (incoming.tags.length > existing.tags.length) existing.tags = incoming.tags;
  if (incoming.firstTag && !existing.firstTag) existing.firstTag = incoming.firstTag;
  if (incoming.timelineStatus && !existing.timelineStatus)
    existing.timelineStatus = incoming.timelineStatus;
}

function accumulateFeatures(
  features: maplibregl.MapGeoJSONFeature[],
  centerLat: number,
  centerLng: number,
): VisibleProject[] {
  const seen = new Map<string, VisibleProject>();
  for (const f of features) {
    const incoming = featureToProject(f, centerLat, centerLng);
    if (!incoming) continue;
    const existing = seen.get(incoming.id);
    if (!existing) {
      seen.set(incoming.id, incoming);
    } else {
      mergeIntoExisting(existing, incoming);
    }
  }
  const result = [...seen.values()];
  // Sort by id for stable ordering: queryRenderedFeatures returns features in
  // non-deterministic tile-load order, so without this, projectsChanged() would
  // see two arrays with identical content but different order as a "change",
  // causing a spurious rawProjects update and a Vue re-render.
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

/** Returns [lat, lng] of the geometry vertex closest to (centerLat, centerLng).
 * For a linestring this is always a point on the drawn line and is likely on screen,
 * since it's the part of the clipped tile geometry nearest to the viewport center.
 * Returns [null, null] if the geometry has no coordinates.
 */
function getGeomClosestToCenter(
  geom: GeoJSON.Geometry | null,
  centerLat: number,
  centerLng: number,
): [number | null, number | null] {
  if (!geom) return [null, null];
  const coords = collectCoords(geom);
  if (coords.length === 0) return [null, null];
  let bestLat = coords[0]?.[1] ?? null;
  let bestLng = coords[0]?.[0] ?? null;
  let bestDist = Infinity;
  for (const coord of coords) {
    const lat = coord[1] ?? 0;
    const lng = coord[0] ?? 0;
    const dist = (lat - centerLat) ** 2 + (lng - centerLng) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestLat = lat;
      bestLng = lng;
    }
  }
  return [bestLat, bestLng];
}

/** Returns [centerLng, centerLat, bounds, bottomLat, bottomLng] from the geometry's coordinate bbox. */
function getGeomBbox(
  geom: GeoJSON.Geometry | null,
): [number | null, number | null, LngLatBounds | null, number | null, number | null] {
  if (!geom) return [null, null, null, null, null];
  const coords = collectCoords(geom);
  if (coords.length === 0) return [null, null, null, null, null];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  let bottomLng: number | null = null;
  for (const coord of coords) {
    const x = coord[0] ?? 0;
    const y = coord[1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) {
      minY = y;
      bottomLng = x;
    }
    if (y > maxY) maxY = y;
  }
  const bounds = new LngLatBounds([minX, minY], [maxX, maxY]);
  return [(minX + maxX) / 2, (minY + maxY) / 2, bounds, minY, bottomLng];
}

/**
 * Calculates the best on-screen anchor coordinate for a project and triggers the hover preview card.
 * It prefers the southernmost visible point of the geometry (bottomLat) to anchor the card at the bottom.
 * If that point is off-screen or outside the safe padded area, it falls back to the geometry coordinate
 * closest to the center of the screen (midLat) to prevent the card from appearing visually detached.
 */
function showHoverCardForProject(project: VisibleProject): void {
  const mlMap = map.value;
  const rect = mlMap.getContainer().getBoundingClientRect();
  const INSET = 100;

  // 1. Default anchor: the lowest/southernmost point of the geometry
  let lat = project.bottomLat ?? project.midLat ?? project.lat;
  let lng = project.bottomLng ?? project.midLng ?? project.lng;
  let pt = lat !== null && lng !== null ? mlMap.project([lng, lat]) : null;

  // 2. Check if this point falls outside the safe padded area of the map viewport
  const isOutsideSafeInset =
    pt && (pt.x < INSET || pt.x > rect.width - INSET || pt.y < INSET || pt.y > rect.height - INSET);

  // 3. If outside, the hover card's own bounding logic would aggressively clamp it to the edge,
  //    separating it from the geometry. Fallback to the geometry vertex closest to the screen center.
  if (isOutsideSafeInset && project.midLat !== null && project.midLng !== null) {
    lat = project.midLat;
    lng = project.midLng;
    pt = mlMap.project([lng, lat]);
  }

  // 4. Trigger the hover preview card, projecting map-relative pixels to global viewport coordinates
  if (pt !== null) {
    triggerProjectHover(
      project.id,
      { name: project.name, timelineStatus: project.timelineStatus, tags: project.tags },
      pt.x + rect.left,
      pt.y + rect.top,
      true, // immediate
    );
  }
}

export function useVisibleProjects() {
  const rawProjects = ref<VisibleProject[]>([]);
  const sortMode = ref<SortMode>("recent");
  const sortReverse = ref(false);
  const isReady = ref(false);
  const uiStore = useUiStore();

  const projects = computed<VisibleProject[]>(() => {
    const [minDateMs, maxDateMs] = lastModifiedDateRange.value;
    const [minSizeM, maxSizeM] = sizeFilterRange.value;

    const filtered = rawProjects.value.filter((p) => {
      if (p.lastModifiedS > 0) {
        const dateMs = p.lastModifiedS * 1000;
        if (dateMs < minDateMs || dateMs > maxDateMs) return false;
      }
      // sizeM 0 means no geometry size (overlay footprints, standalone points); the map's
      // footprint/shape layers exempt these from the size filter, so the panel must too.
      if (p.sizeM > 0 && (p.sizeM < minSizeM || p.sizeM > maxSizeM)) return false;
      return true;
    });

    function compareBySortMode(a: VisibleProject, b: VisibleProject): number {
      if (sortMode.value === "recent") {
        const result = b.lastModifiedS - a.lastModifiedS;
        return sortReverse.value ? -result : result;
      }
      if (sortMode.value === "name") {
        // When sorting by name, put unnamed projects at the bottom
        if (a.name && !b.name) return sortReverse.value ? 1 : -1;
        if (!a.name && b.name) return sortReverse.value ? -1 : 1;
        const result = (a.name ?? "").localeCompare(b.name ?? "");
        return sortReverse.value ? -result : result;
      }
      if (sortMode.value === "size") {
        const result = b.sizeM - a.sizeM;
        return sortReverse.value ? -result : result;
      }
      const result = (STATUS_RANK[a.timelineStatus] ?? 99) - (STATUS_RANK[b.timelineStatus] ?? 99);
      return sortReverse.value ? -result : result;
    }
    return filtered.toSorted(compareBySortMode);
  });

  // We gate doRefresh on this flag to avoid querying on every drag frame.
  let mapMoving = false;

  let isActive = true;
  // Set on unmount so a one-shot `render` listener that fires after teardown no-ops
  // instead of refreshing a dead instance.
  let destroyed = false;

  onActivated(() => {
    isActive = true;
    scheduleRefresh();
  });

  onDeactivated(() => {
    isActive = false;
  });

  function doRefresh() {
    const mlMap = map.value;
    // Skip if the map is still animating, or if tiles for the current viewport
    // haven't finished loading yet (e.g. mid-zoom). The idle/sourcedata handlers
    // will re-trigger once everything is ready.
    if (!isActive || mapMoving || !mlMap.areTilesLoaded()) return;

    const canvas = mlMap.getCanvas();
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const INSET = 100; // px, avoids listing projects obscured by UI chrome

    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [INSET, INSET],
      [w - INSET, h - INSET],
    ];
    const features = mlMap.queryRenderedFeatures(bbox, { layers: [...QUERY_LAYERS] });

    const center = mlMap.getCenter();
    const newProjects = accumulateFeatures(features, center.lat, center.lng);
    if (projectsChanged(rawProjects.value, newProjects)) rawProjects.value = newProjects;
  }

  // pendingQuery: a one-shot `render` listener has been registered and will call doRefresh()
  // after the very next paint frame. Using `render` guarantees that
  // queryRenderedFeatures sees a fully-painted frame with all loaded tile data.
  let pendingQuery = false;

  function scheduleRefresh() {
    if (!isActive) return;
    const mlMap = map.value;
    if (pendingQuery) return;

    pendingQuery = true;
    void mlMap.once("render", () => {
      pendingQuery = false;
      if (destroyed) return;
      doRefresh();
    });

    // Force a render frame so our listener above is guaranteed to fire,
    // even if there were no visual changes on the map.
    mlMap.triggerRepaint();
  }

  let idleHandler: (() => void) | null = null;
  let sourcedataHandler: (() => void) | null = null;
  let sourcedataTimer: ReturnType<typeof setTimeout> | null = null;
  let moveStartHandler: (() => void) | null = null;
  let moveEndHandler: (() => void) | null = null;

  onMlMapReady(() => {
    isReady.value = true;
    const mlMap = map.value;
    // Skip refreshes mid-move; refresh once the camera settles.
    moveStartHandler = () => {
      mapMoving = true;
    };
    moveEndHandler = () => {
      mapMoving = false;
      scheduleRefresh();
    };
    mlMap.on("movestart", moveStartHandler);
    mlMap.on("moveend", moveEndHandler);

    // `idle` fires when the map stops moving AND all tiles are loaded.
    // We still piggyback a render-frame defer to guarantee the paint is done.
    idleHandler = scheduleRefresh;
    mlMap.on("idle", idleHandler);

    // `sourcedata` fires when any source finishes loading tile data. Catching
    // the moment areTilesLoaded() first becomes true covers the race where the
    // camera moved so quickly that `idle` fired before tiles were fetched.
    // Debounced to avoid firing on every individual tile during a pan.
    sourcedataHandler = () => {
      if (!mlMap.areTilesLoaded() || mlMap.isMoving()) return;
      if (sourcedataTimer) clearTimeout(sourcedataTimer);
      sourcedataTimer = setTimeout(() => {
        sourcedataTimer = null;
        if (mlMap.areTilesLoaded() && !mlMap.isMoving()) scheduleRefresh();
      }, 150);
    };
    mlMap.on("sourcedata", sourcedataHandler);

    // Refresh initially
    scheduleRefresh();
  });

  onUnmounted(() => {
    destroyed = true;
    if (sourcedataTimer) clearTimeout(sourcedataTimer);
    pendingQuery = false;
    mapMoving = false;
    const mlMap = map.value;
    if (mlMap) {
      if (moveStartHandler) mlMap.off("movestart", moveStartHandler);
      if (moveEndHandler) mlMap.off("moveend", moveEndHandler);
      if (idleHandler) mlMap.off("idle", idleHandler);
      if (sourcedataHandler) mlMap.off("sourcedata", sourcedataHandler);
    }
  });

  // Suppresses hover updates while the camera is flying after a project click.
  // Cleared on the map's moveend so accidental mouseover on reshuffled rows
  // doesn't highlight a different project.
  let suppressHover = false;

  function navigateToProject(project: VisibleProject) {
    // Use the nearest vertex of the clipped tile geometry as the anchor (it's on the drawn line).
    // Fall back to popup_lat/popup_lng (ST_PointOnSurface of the full geometry) for standalone points.
    function resolveAnchor(): { lat: number; lng: number } {
      if (project.midLat !== null && project.midLng !== null) {
        return { lat: project.midLat, lng: project.midLng };
      }
      if (project.lat !== null && project.lng !== null) {
        return { lat: project.lat, lng: project.lng };
      }
      const center = map.value.getCenter();
      return { lat: center.lat, lng: center.lng };
    }
    const latlng = resolveAnchor();

    // Block hover events until the list has finished re-rendering after the fly.
    // moveend fires when the camera stops, but the list updates asynchronously
    // (MapLibre idle → doRefresh → Vue re-render). A short delay after moveend
    // ensures the DOM has settled before hover is re-enabled.
    suppressHover = true;
    void map.value.once("moveend", () => {
      setTimeout(() => {
        suppressHover = false;
      }, 200);
    });

    flyToGeometry(latlng, project.sizeM);

    void handleProjectClickFromTile(project.id);
  }

  let lastHoveredProjectId: string | null = null;
  let hoverClearTimeout: ReturnType<typeof setTimeout> | null = null;

  function hoverProject(project: VisibleProject | null) {
    if (suppressHover) return;

    if (hoverClearTimeout) {
      clearTimeout(hoverClearTimeout);
      hoverClearTimeout = null;
    }

    const projectId = project?.id ?? null;

    if (projectId && projectId === lastHoveredProjectId) return;

    if (project && projectId) {
      highlightProject(projectId);
      lastHoveredProjectId = projectId;
      showHoverCardForProject(project);
    } else if (lastHoveredProjectId) {
      // Defer clearing the hover to avoid double map-updates when the mouse
      // instantly moves from one row to another (mouseleave -> mouseenter).
      hoverClearTimeout = setTimeout(() => {
        const prevProjectId = lastHoveredProjectId;
        lastHoveredProjectId = null;
        if (prevProjectId) {
          removeProjectOutlines(prevProjectId);
        }

        if (!uiStore.projectDetail.visible) {
          setExternalHover(null);
        }
        clearHoverPreview();
      }, 20);
    }
  }

  // When the project detail closes, release any vector tile hover that was pinned by a click.
  // This is the counterpart to the detailPinsHighlight guard above.
  watch(
    () => uiStore.projectDetail.visible,
    (isVisible) => {
      if (!isVisible) {
        setExternalHover(null);
      }
    },
  );

  return {
    projects,
    sortMode,
    sortReverse,
    isReady,
    navigateToProject,
    hoverProject,
  };
}
