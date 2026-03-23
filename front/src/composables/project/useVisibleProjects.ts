import { ref, computed, watch, onUnmounted } from "vue";
import L from "leaflet";
import * as maplibregl from "maplibre-gl";
import { getMlMap, onMlMapReady } from "@/services/map/tileLayers";
import { setHoveredProjectId } from "@/services/map/projectVectorLayers";
import { map } from "@/services/core/map";
import { handleProjectClickFromTile } from "@/services/map/standaloneProjectMarkers";
import { useUiStore } from "@/stores/uiStore";

export type SortMode = "recent" | "name" | "size" | "status";

export interface VisibleProject {
  id: string;
  name: string;
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

const QUERY_LAYERS = ["project-points", "project-shapes", "overlay-footprints"] as const;

function collectCoords(geom: GeoJSON.Geometry): number[][] {
  switch (geom.type) {
    case "Point":
      return [geom.coordinates as number[]];
    case "LineString":
    case "MultiPoint":
      return geom.coordinates as number[][];
    case "Polygon":
    case "MultiLineString":
      return (geom.coordinates as number[][][]).flat();
    case "MultiPolygon":
      return (geom.coordinates as number[][][][]).flat(2);
    case "GeometryCollection":
      return geom.geometries.flatMap(collectCoords);
    default:
      return [];
  }
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
    const x = coord[0] as number;
    const y = coord[1] as number;
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
    const named = rawProjects.value.filter((p) => p.name);
    const unnamed = rawProjects.value.filter((p) => !p.name);

    function compareBySortMode(a: VisibleProject, b: VisibleProject): number {
      let result = 0;
      if (sortMode.value === "recent") {
        result = b.lastModifiedS - a.lastModifiedS;
      } else if (sortMode.value === "name") {
        result = a.name.localeCompare(b.name);
      } else if (sortMode.value === "size") {
        result = b.sizeM - a.sizeM;
      } else if (sortMode.value === "status") {
        result = (STATUS_RANK[a.timelineStatus] ?? 99) - (STATUS_RANK[b.timelineStatus] ?? 99);
      }
      return sortReverse.value ? -result : result;
    }

    return [...named.sort(compareBySortMode), ...unnamed.sort(compareBySortMode)];
  });

  function refresh() {
    const mlMap = getMlMap();
    if (!mlMap) return;

    const canvas = mlMap.getCanvas();
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const INSET = 50;

    // On mobile, the drawer overlaps the bottom of the map -- exclude that area
    const drawerOffsetPx = uiStore.mobileDrawerVisible
      ? (uiStore.mobileDrawerHeightPercent / 100) * window.innerHeight
      : 0;

    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [INSET, INSET],
      [w - INSET, h - drawerOffsetPx - INSET],
    ];
    // applying an inset to avoid projects that are at the edge of the screen
    const features = mlMap.queryRenderedFeatures(bbox, { layers: [...QUERY_LAYERS] });

    const seen = new Map<string, VisibleProject>();

    for (const f of features) {
      const props = f.properties ?? {};
      const sourceLayer = String((f as any).sourceLayer ?? "");

      let id: string;
      let name: string;

      if (sourceLayer === "overlay-footprints") {
        id = String(props["project_id"] ?? "");
        name = "";
      } else {
        id = String(props["id"] ?? "");
        name = String(props["name"] ?? "");
      }

      if (!id) continue;

      const [lng, lat] = getBboxCenter(f.geometry as GeoJSON.Geometry | null);

      // project-points uses max_size_m, project-shapes uses geometry_size_m
      const sizeM = Number(props["geometry_size_m"] ?? props["max_size_m"] ?? 0);

      if (!seen.has(id)) {
        seen.set(id, {
          id,
          name,
          firstTag: String(props["first_tag"] ?? ""),
          timelineStatus: String(props["timeline_status"] ?? ""),
          lastModifiedS: Number(props["last_modified_s"] ?? 0),
          sizeM,
          lat,
          lng,
        });
      } else {
        const existing = seen.get(id)!;
        if (name && !existing.name) existing.name = name;
        if (lat !== null && existing.lat === null) {
          existing.lat = lat;
          existing.lng = lng;
        }
      }
    }

    rawProjects.value = [...seen.values()];
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRefresh() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 150);
  }

  let idleHandler: (() => void) | null = null;

  onMlMapReady(() => {
    isReady.value = true;
    const mlMap = getMlMap();
    if (!mlMap) return;
    idleHandler = scheduleRefresh;
    mlMap.on("idle", idleHandler);
    refresh();
  });

  // Re-run when the drawer is resized or toggled (map idle won't fire in that case)
  watch(() => [uiStore.mobileDrawerHeightPercent, uiStore.mobileDrawerVisible], scheduleRefresh);

  onUnmounted(() => {
    if (timer) clearTimeout(timer);
    const mlMap = getMlMap();
    if (mlMap && idleHandler) {
      mlMap.off("idle", idleHandler);
    }
  });

  function navigateToProject(project: VisibleProject) {
    const latlng =
      project.lat !== null && project.lng !== null
        ? L.latLng(project.lat, project.lng) // lat, lng order for Leaflet
        : map.value.getCenter();
    void handleProjectClickFromTile(project.id, latlng);
  }

  function hoverProject(projectId: string | null) {
    const mlMap = getMlMap();
    if (!mlMap) return;
    setHoveredProjectId(mlMap, projectId);
  }

  return { projects, sortMode, sortReverse, isReady, refresh, navigateToProject, hoverProject };
}
