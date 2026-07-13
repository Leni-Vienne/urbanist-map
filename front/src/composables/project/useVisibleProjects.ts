import { ref, computed, onUnmounted, onActivated, onDeactivated } from "vue";
import type * as maplibregl from "maplibre-gl";
import { useFocusStore } from "@/stores/focusStore";
import { map, onMlMapReady } from "@/services/core/map";
import { handleProjectClickFromTile } from "@/services/map/projectSelection";
import { VECTOR_QUERY_LAYERS } from "@/services/map/tiles/queryLayers";
import { flyToGeometry } from "@/services/map/mapNavigation";
import { lastModifiedDateRange, sizeFilterRange } from "@/services/map/filters";
import { forEachPosition } from "@/utils/geojson";
import { triggerProjectHover, clearHoverPreview } from "@/services/map/hoverPreviewState";

export type SortMode = "recent" | "name" | "size" | "status";

interface VisibleProject {
  id: string;
  name: string | null;
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

interface GeomAnchors {
  /** Geometry bbox center, used as the popup_lat/lng fallback for standalone points. */
  centerLat: number | null;
  centerLng: number | null;
  /** Southernmost vertex, preferred anchor so the hover card sits below the geometry. */
  bottomLat: number | null;
  bottomLng: number | null;
  /** Vertex closest to the viewport center: always on the drawn line and likely on screen. */
  midLat: number | null;
  midLng: number | null;
}

const EMPTY_ANCHORS: GeomAnchors = {
  centerLat: null,
  centerLng: null,
  bottomLat: null,
  bottomLng: null,
  midLat: null,
  midLng: null,
};

/**
 * Single pass over a geometry's vertices producing every anchor the panel needs: the bbox center
 * (popup fallback), the southernmost vertex (hover-card anchor), and the vertex nearest the given
 * viewport center (on-line anchor). Returns all-null anchors for empty/missing geometry.
 */
function computeGeomAnchors(
  geom: GeoJSON.Geometry | null,
  centerLat: number,
  centerLng: number,
): GeomAnchors {
  if (!geom) return EMPTY_ANCHORS;

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  let bottomLng: number | null = null;
  let bestLat: number | null = null;
  let bestLng: number | null = null;
  let bestDist = Infinity;
  let count = 0;

  forEachPosition(geom, (lng, lat) => {
    count += 1;
    if (lng < minX) minX = lng;
    if (lng > maxX) maxX = lng;
    if (lat < minY) {
      minY = lat;
      bottomLng = lng;
    }
    if (lat > maxY) maxY = lat;
    const dist = (lat - centerLat) ** 2 + (lng - centerLng) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestLat = lat;
      bestLng = lng;
    }
  });

  if (count === 0) return EMPTY_ANCHORS;

  return {
    centerLat: (minY + maxY) / 2,
    centerLng: (minX + maxX) / 2,
    bottomLat: minY,
    bottomLng,
    midLat: bestLat,
    midLng: bestLng,
  };
}

// When the visible set is unchanged but the camera moved, the viewport-relative anchors
// (mid/bottom vertices and popup fallback) were recomputed against the new center. Copy them onto
// the existing entries in place so hover cards and navigation use current coordinates, without
// replacing the array (which would re-sort and re-render the list). The `projects` computed does
// not read these fields, so the mutation triggers no list churn.
function syncAnchors(existing: VisibleProject[], next: VisibleProject[]): void {
  const byId = new Map(next.map((p) => [p.id, p]));
  for (const entry of existing) {
    const fresh = byId.get(entry.id);
    if (!fresh) continue;
    entry.lat = fresh.lat;
    entry.lng = fresh.lng;
    entry.midLat = fresh.midLat;
    entry.midLng = fresh.midLng;
    entry.bottomLat = fresh.bottomLat;
    entry.bottomLng = fresh.bottomLng;
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
      Math.round(p.sizeM) !== Math.round(n.sizeM)
    )
      return true;
  }
  return false;
}

/** Tile features carry tags as a JSON-encoded string; parse them back into an array. */
function parseMvtTags(raw: unknown): string[] {
  try {
    if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string");
    // oxlint-disable-next-line no-unsafe-type-assertion
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
  const anchors = computeGeomAnchors(geom, centerLat, centerLng);
  // popup_lat/popup_lng are ST_PointOnSurface of the full unclipped geometry, used as fallback
  // for standalone points that have no clipped geometry midpoint.
  const lat =
    props.popup_lat !== null && props.popup_lat !== undefined
      ? Number(props.popup_lat)
      : anchors.centerLat;
  const lng =
    props.popup_lng !== null && props.popup_lng !== undefined
      ? Number(props.popup_lng)
      : anchors.centerLng;
  const rawSize = props.geometry_size_m ?? props.max_size_m;
  return {
    id,
    name,
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
    midLat: anchors.midLat,
    midLng: anchors.midLng,
    bottomLat: anchors.bottomLat,
    bottomLng: anchors.bottomLng,
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
  const focusStore = useFocusStore();

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

  let isActive = true;

  onActivated(() => {
    isActive = true;
    refresh();
  });

  onDeactivated(() => {
    isActive = false;
  });

  function refresh() {
    if (!isActive || !isReady.value) return;
    const mlMap = map.value;
    // Skip if the map is still animating, or if tiles for the current viewport
    // haven't finished loading yet (e.g. mid-zoom). Both states resolve into a
    // later `idle`, which calls back in.
    if (mlMap.isMoving() || !mlMap.areTilesLoaded()) return;

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
    if (projectsChanged(rawProjects.value, newProjects)) {
      rawProjects.value = newProjects;
    } else {
      syncAnchors(rawProjects.value, newProjects);
    }
  }

  let hoverClearTimeout: ReturnType<typeof setTimeout> | null = null;

  onMlMapReady(() => {
    isReady.value = true;
    // maplibre fires `idle` at the end of every rendered frame that ends with the camera
    // still and all source tiles loaded; any change (camera move, tile arrival, data or
    // style update) dirties the map and yields another such frame, hence another `idle`.
    // One listener therefore covers every way the visible feature set can change, and
    // queryRenderedFeatures inside it sees the fully-painted frame. The handler must not
    // trigger a repaint: the forced frame would end clean, fire `idle` again, and sustain
    // an endless render loop.
    map.value.on("idle", refresh);

    // Covers the map already sitting idle (no `idle` fires until something changes).
    refresh();
  });

  onUnmounted(() => {
    if (hoverClearTimeout) clearTimeout(hoverClearTimeout);
    // oxlint-disable-next-line no-unnecessary-condition
    if (map.value) map.value.off("idle", refresh);
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
    // (MapLibre idle → refresh → Vue re-render). A short delay after moveend
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

  function hoverProject(project: VisibleProject | null) {
    if (suppressHover) return;

    if (hoverClearTimeout) {
      clearTimeout(hoverClearTimeout);
      hoverClearTimeout = null;
    }

    const projectId = project?.id ?? null;

    if (projectId && projectId === lastHoveredProjectId) return;

    if (project && projectId) {
      focusStore.setHover({ kind: "project", projectId });
      lastHoveredProjectId = projectId;
      showHoverCardForProject(project);
    } else if (lastHoveredProjectId) {
      // Defer clearing the hover to avoid double map-updates when the mouse
      // instantly moves from one row to another (mouseleave -> mouseenter).
      hoverClearTimeout = setTimeout(() => {
        lastHoveredProjectId = null;
        focusStore.setHover(null);
        clearHoverPreview();
      }, 20);
    }
  }

  return {
    projects,
    sortMode,
    sortReverse,
    isReady,
    navigateToProject,
    hoverProject,
  };
}
