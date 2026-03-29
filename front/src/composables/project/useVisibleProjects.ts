import { ref, computed, watch, onUnmounted } from "vue";
import L from "leaflet";
import type * as maplibregl from "maplibre-gl";
import { getMlMap, onMlMapReady } from "@/services/map/tileLayers";
import {
  highlightProjectOverlaysOnHover,
  removeProjectOutlines,
} from "@/services/overlay/overlaySelection";
import { setOverlayDrivenHover } from "@/services/map/vectorHoverState";
import { map } from "@/services/core/map";
import { handleProjectClickFromTile } from "@/services/map/standaloneProjectMarkers";
import { VECTOR_QUERY_LAYERS } from "@/services/map/projectVectorLayers";
import { useUiStore } from "@/stores/uiStore";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { lastModifiedDateRange, sizeFilterRange } from "@/services/overlay/statusFilters";

export type SortMode = "recent" | "name" | "size" | "status";

interface VisibleProject {
  id: string;
  name: string | null;
  firstTag: string;
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
  switch (geom.type) {
    case "Point":
      return [geom.coordinates];
    case "LineString":
    case "MultiPoint":
      return geom.coordinates;
    case "Polygon":
    case "MultiLineString":
      return geom.coordinates.flat();
    case "MultiPolygon":
      return geom.coordinates.flat(2);
    case "GeometryCollection":
      return geom.geometries.flatMap(collectCoords);
    default:
      return [];
  }
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

function accumulateFeatures(features: maplibregl.MapGeoJSONFeature[]): VisibleProject[] {
  const seen = new Map<string, VisibleProject>();
  for (const f of features) {
    const props = f.properties;
    const sourceLayer = String(f.sourceLayer);
    const id = sourceLayer === "overlay-footprints" ? (props.project_id ?? "") : (props.id ?? "");
    const name: string | null = sourceLayer === "overlay-footprints" ? null : (props.name ?? null);
    if (!id) continue;
    const [lng, lat] = getBboxCenter(f.geometry as GeoJSON.Geometry | null);
    const sizeM = Number(props.geometry_size_m ?? props.max_size_m ?? 0);
    if (!seen.has(id)) {
      seen.set(id, {
        id,
        name,
        firstTag: props.first_tag ?? "",
        timelineStatus: props.timeline_status ?? "",
        lastModifiedS: Number(props.last_modified_s ?? 0),
        sizeM,
        lat,
        lng,
      });
    } else {
      const existing = seen.get(id);
      if (!existing) continue;
      if (name && !existing.name) existing.name = name;
      if (lat !== null && existing.lat === null) {
        existing.lat = lat;
        existing.lng = lng;
      }
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

function getBboxCenter(geom: GeoJSON.Geometry | null): [number | null, number | null] {
  if (!geom) return [null, null];
  const coords = collectCoords(geom);
  if (coords.length === 0) return [null, null];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const coord of coords) {
    const x = coord[0]!;
    const y = coord[1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
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
      if (p.sizeM < minSizeM || p.sizeM > maxSizeM) return false;
      return true;
    });

    const named = filtered.filter((p) => p.name);
    const unnamed = filtered.filter((p) => !p.name);

    function compareBySortMode(a: VisibleProject, b: VisibleProject): number {
      let result = 0;
      if (sortMode.value === "recent") {
        result = b.lastModifiedS - a.lastModifiedS;
      } else if (sortMode.value === "name") {
        result = (a.name ?? "").localeCompare(b.name ?? "");
      } else if (sortMode.value === "size") {
        result = b.sizeM - a.sizeM;
      } else if (sortMode.value === "status") {
        result = (STATUS_RANK[a.timelineStatus] ?? 99) - (STATUS_RANK[b.timelineStatus] ?? 99);
      }
      return sortReverse.value ? -result : result;
    }
    return [...named.toSorted(compareBySortMode), ...unnamed.toSorted(compareBySortMode)];
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
    const INSET = 100; // px inset from edge to avoid listing projects under UI elements

    // On mobile, the drawer overlaps the bottom of the map -- exclude that area
    const isMobile = window.innerWidth <= 768;
    const drawerOffsetPx =
      isMobile && uiStore.mobileDrawerVisible
        ? (uiStore.mobileDrawerHeightPercent / 100) * window.innerHeight
        : 0;

    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [INSET, INSET],
      [w - INSET, h - drawerOffsetPx - INSET],
    ];
    // applying an inset to avoid projects that are at the edge of the screen
    const features = mlMap.queryRenderedFeatures(bbox, { layers: [...QUERY_LAYERS] });

    const newProjects = accumulateFeatures(features);
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

    scheduleRefresh();
  });

  // Re-run when the drawer is resized or toggled (map idle won't fire in that case)
  watch(() => [uiStore.mobileDrawerHeightPercent, uiStore.mobileDrawerVisible], scheduleRefresh);

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

  function navigateToProject(project: VisibleProject) {
    const latlng =
      project.lat !== null && project.lng !== null
        ? L.latLng(project.lat, project.lng) // lat, lng order for Leaflet
        : map.value.getCenter();

    // Compute a zoom level that fits the project's footprint.
    // sizeM is the longest dimension; build a square bounds around the center,
    // ask Leaflet for the zoom that fits it, then cap at 19.
    const halfDeg = project.sizeM > 0 ? project.sizeM / 2 / 111_320 : 0.001;
    const bounds = L.latLngBounds(
      [latlng.lat - halfDeg, latlng.lng - halfDeg],
      [latlng.lat + halfDeg, latlng.lng + halfDeg],
    );
    const zoom = Math.min(map.value.getBoundsZoom(bounds, false), 19);
    mobileAwareFlyTo(latlng, zoom, { duration: 1.5, easeLinearity: 0.25 });

    void handleProjectClickFromTile(project.id, latlng);
  }

  let lastHoveredProjectId: string | null = null;

  function hoverProject(projectId: string | null) {
    if (projectId) {
      highlightProjectOverlaysOnHover(projectId);
      lastHoveredProjectId = projectId;
    } else if (lastHoveredProjectId) {
      const prevProjectId = lastHoveredProjectId;
      lastHoveredProjectId = null;
      removeProjectOutlines(prevProjectId);

      // If the popup just opened for this project (user clicked it), keep the vector tile
      // highlight alive — it acts as a "selected" state until the popup is dismissed.
      // The watcher below clears setOverlayDrivenHover when the popup eventually closes.
      const popupPinsHighlight =
        uiStore.projectInfoPopup.visible && uiStore.projectInfoPopup.projectId === prevProjectId;
      if (!popupPinsHighlight) {
        setOverlayDrivenHover(null);
      }
    }
  }

  // When the project info popup closes, release any vector tile hover that was pinned by a click.
  // This is the counterpart to the popupPinsHighlight guard above.
  watch(
    () => uiStore.projectInfoPopup.visible,
    (isVisible) => {
      if (!isVisible) {
        setOverlayDrivenHover(null);
      }
    },
  );

  return {
    projects,
    sortMode,
    sortReverse,
    isReady,
    refresh: scheduleRefresh,
    navigateToProject,
    hoverProject,
  };
}
