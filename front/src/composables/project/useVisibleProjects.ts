import { ref, computed, watch, onUnmounted } from "vue";
import L from "leaflet";
import type * as maplibregl from "maplibre-gl";
import { getMlMap, onMlMapReady } from "@/services/map/tileLayers";
import { highlightProject, removeProjectOutlines } from "@/services/overlay/overlaySelection";
import { setExternalHover } from "@/services/map/vectorHoverState";
import { map } from "@/services/core/map";
import { handleProjectClickFromTile } from "@/services/map/projectSelection";
import { VECTOR_QUERY_LAYERS, getZoomForGeometrySize } from "@/services/map/projectVectorLayers";
import { useUiStore } from "@/stores/uiStore";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { lastModifiedDateRange, sizeFilterRange } from "@/services/overlay/statusFilters";
import { forEachPosition } from "@/utils/geojson";

export type SortMode = "recent" | "name" | "size" | "status";

interface VisibleProject {
  id: string;
  name: string | null;
  /** Actual geometry bbox from the MVT feature, used for zooming. Null for standalone points. */
  bbox: L.LatLngBounds | null;
  /** Middle vertex of the clipped tile geometry, guaranteed on the drawn line, used as popup anchor. */
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
      p.sizeM !== n.sizeM
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
  const [bboxLng, bboxLat, bbox] = getGeomBbox(geom);
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

/** Returns [centerLng, centerLat, bounds] from the geometry's coordinate bbox. */
function getGeomBbox(
  geom: GeoJSON.Geometry | null,
): [number | null, number | null, L.LatLngBounds | null] {
  if (!geom) return [null, null, null];
  const coords = collectCoords(geom);
  if (coords.length === 0) return [null, null, null];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const coord of coords) {
    const x = coord[0] ?? 0;
    const y = coord[1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bounds = L.latLngBounds([minY, minX], [maxY, maxX]);
  return [(minX + maxX) / 2, (minY + maxY) / 2, bounds];
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
      let result = 0;
      if (sortMode.value === "recent") {
        result = b.lastModifiedS - a.lastModifiedS;
      } else if (sortMode.value === "name") {
        // When sorting by name, put unnamed projects at the bottom
        if (a.name && !b.name) return sortReverse.value ? 1 : -1;
        if (!a.name && b.name) return sortReverse.value ? -1 : 1;
        result = (a.name ?? "").localeCompare(b.name ?? "");
      } else if (sortMode.value === "size") {
        result = b.sizeM - a.sizeM;
      } else if (sortMode.value === "status") {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        result = (STATUS_RANK[a.timelineStatus] ?? 99) - (STATUS_RANK[b.timelineStatus] ?? 99);
      }
      return sortReverse.value ? -result : result;
    }
    return filtered.toSorted(compareBySortMode);
  });

  // We gate doRefresh on this flag to avoid querying on every drag frame.
  let leafletMoving = false;

  function doRefresh() {
    const mlMap = getMlMap();
    // Skip if Leaflet is still animating, or if tiles for the current viewport
    // haven't finished loading yet (e.g. mid-zoom). The idle/sourcedata handlers
    // will re-trigger once everything is ready.
    if (!mlMap || leafletMoving || !mlMap.areTilesLoaded()) return;

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

    const center = map.value.getCenter();
    const newProjects = accumulateFeatures(features, center.lat, center.lng);
    if (projectsChanged(rawProjects.value, newProjects)) rawProjects.value = newProjects;
  }

  // pendingQuery: a one-shot `render` listener has been registered and will call doRefresh()
  // after the very next paint frame. Using `render` (not a timer) guarantees that
  // queryRenderedFeatures sees a fully-painted frame with all loaded tile data.
  let pendingQuery = false;

  function scheduleRefreshAfterRender() {
    const mlMap = getMlMap();
    if (!mlMap || pendingQuery) return;
    pendingQuery = true;
    void mlMap.once("render", () => {
      pendingQuery = false;
      doRefresh();
    });
  }

  // Fallback for cases where the mlMap stops firing `render` altogether (e.g. nothing
  // visually changed after the triggering event). Bypasses the render-frame wait and
  // queries directly. leafletMoving is rechecked inside doRefresh so this is safe.
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRefresh() {
    scheduleRefreshAfterRender();
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      pendingQuery = false;
      doRefresh();
    }, 500);
  }

  let idleHandler: (() => void) | null = null;
  let sourcedataHandler: (() => void) | null = null;
  let sourcedataTimer: ReturnType<typeof setTimeout> | null = null;
  let moveStartHandler: (() => void) | null = null;
  let moveEndHandler: (() => void) | null = null;

  onMlMapReady(() => {
    isReady.value = true;
    const mlMap = getMlMap();
    if (!mlMap) return;

    // MaplibreLayer forwards Leaflet movestart/moveend onto mlMap, so these fire
    // correctly during Leaflet drags even though MapLibre itself isn't moving.
    moveStartHandler = () => {
      leafletMoving = true;
    };
    moveEndHandler = () => {
      leafletMoving = false;
      scheduleRefresh();
    };
    mlMap.on("leaflet-movestart", moveStartHandler);
    mlMap.on("leaflet-moveend", moveEndHandler);

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
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (sourcedataTimer) clearTimeout(sourcedataTimer);
    pendingQuery = false;
    leafletMoving = false;
    const mlMap = getMlMap();
    if (mlMap) {
      if (moveStartHandler) mlMap.off("leaflet-movestart", moveStartHandler);
      if (moveEndHandler) mlMap.off("leaflet-moveend", moveEndHandler);
      if (idleHandler) mlMap.off("idle", idleHandler);
      if (sourcedataHandler) mlMap.off("sourcedata", sourcedataHandler);
    }
  });

  // Suppresses hover updates while the camera is flying after a project click.
  // Cleared on Leaflet's moveend so accidental mouseover on reshuffled rows
  // doesn't highlight a different project.
  let suppressHover = false;

  function navigateToProject(project: VisibleProject) {
    // Use the nearest vertex of the clipped tile geometry as the anchor (it's on the drawn line).
    // Fall back to popup_lat/popup_lng (ST_PointOnSurface of the full geometry) for standalone points.
    function resolveAnchor(): L.LatLng {
      if (project.midLat !== null && project.midLng !== null) {
        return L.latLng(project.midLat, project.midLng);
      }
      if (project.lat !== null && project.lng !== null) {
        return L.latLng(project.lat, project.lng);
      }
      return map.value.getCenter();
    }
    const latlng = resolveAnchor();

    // Block hover events until the list has finished re-rendering after the fly.
    // moveend fires when the camera stops, but the list updates asynchronously
    // (MapLibre idle → doRefresh → Vue re-render). A short delay after moveend
    // ensures the DOM has settled before hover is re-enabled.
    suppressHover = true;
    map.value.once("moveend", () => {
      setTimeout(() => {
        suppressHover = false;
      }, 200);
    });

    const currentZoom = map.value.getZoom();
    const idealZoom =
      project.sizeM > 0 ? getZoomForGeometrySize(project.sizeM, latlng.lat, latlng.lng) : 14;
    const targetZoom = Math.max(currentZoom, idealZoom);
    const needsZoom = targetZoom !== currentZoom;
    if (needsZoom) {
      const duration = Math.min(0.3 + (targetZoom - currentZoom) * 0.25, 1.5);
      mobileAwareFlyTo(latlng, targetZoom, { duration });
    }

    void handleProjectClickFromTile(project.id, latlng, needsZoom);
  }

  let lastHoveredProjectId: string | null = null;

  function hoverProject(projectId: string | null) {
    if (suppressHover) return;
    if (projectId) {
      highlightProject(projectId);
      lastHoveredProjectId = projectId;
    } else if (lastHoveredProjectId) {
      const prevProjectId = lastHoveredProjectId;
      lastHoveredProjectId = null;
      removeProjectOutlines(prevProjectId);

      // If any popup is open, keep the driven hover alive, it was pinned by a click and
      // must not be cleared by a sidebar mouseleave (which can fire when the list scrolls
      // to the newly selected project, triggering mouseleave on the previously hovered card).
      // The watcher below clears setExternalHover when the popup eventually closes.
      if (!uiStore.projectInfoPopup.visible) {
        setExternalHover(null);
      }
    }
  }

  // When the project info popup closes, release any vector tile hover that was pinned by a click.
  // This is the counterpart to the popupPinsHighlight guard above.
  watch(
    () => uiStore.projectInfoPopup.visible,
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
