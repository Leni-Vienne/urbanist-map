import L from "leaflet";
import { ref } from "vue";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Map as MaplibreMap, PointLike, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { maplibreLayer, type MaplibreGL } from "@/lib/MaplibreLayer";
import { map } from "@/services/core/map";
import { handleProjectClickFromTile } from "@/services/map/standaloneProjectMarkers";
import { MAP_CONFIG } from "@/constants/mapConstants";
import countryBboxes from "@/assets/country_bboxes.json";
import { getApiUrl } from "@/client";
import { PROJECT_TAGS } from "@/config/projectTags";

interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface CountryBorder {
  code: CountryCode;
  geojson: FeatureCollection<Polygon | MultiPolygon>;
  bbox: BoundingBox;
}

// Helper to convert bbox array to BoundingBox object
function toBoundingBox(bbox: number[]): BoundingBox {
  return {
    /* oxlint-disable no-non-null-assertion */
    minLng: bbox[0]!,
    minLat: bbox[1]!,
    maxLng: bbox[2]!,
    maxLat: bbox[3]!,
    /* oxlint-enable no-non-null-assertion */
  };
}

// Default max native zoom for Esri layer (safe baseline)
const BASELINE_ESRI_MAX_ZOOM = 18;

// Satellite tile layer configurations. "plan" is the MapLibre vector basemap
// and is not listed here (it uses the OpenFreeMap style URL directly).
const satelliteLayerConfigs = {
  esri: {
    label: "Satellite",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    tileSize: 256,
    attribution: "Esri, Maxar, Earthstar Geographics, GIS User Community",
    maxZoom: BASELINE_ESRI_MAX_ZOOM,
  },
  FRA: {
    label: "France",
    tiles: [
      "https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal",
    ],
    tileSize: 256,
    attribution: "IGN-F/Géoportail",
    maxZoom: 19,
  },
  CHE: {
    label: "Switzerland",
    tiles: [
      "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage-product/default/2025/3857/{z}/{x}/{y}.png",
    ],
    tileSize: 256,
    attribution: "© swisstopo",
    maxZoom: 20,
  },
  QC: {
    label: "Québec",
    tiles: [
      "https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Imagerie_Continue/Imagerie_GQ/default/GoogleMapsCompatibleExt2:epsg:3857/{z}/{y}/{x}.jpg",
    ],
    tileSize: 256,
    attribution: "donneesquebec.ca",
    maxZoom: 21,
  },
};

// Derived types — adding a country only requires a new entry in satelliteLayerConfigs above
type SatelliteLayerType = keyof typeof satelliteLayerConfigs;
type CountryCode = Exclude<SatelliteLayerType, "esri">;
export type TileLayerType = "plan" | SatelliteLayerType;

const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Current active tile layer ("plan" = MapLibre vector basemap)
export const currentTileLayer = ref<TileLayerType>("plan");

/** Reference to the underlying MapLibre map instance. Available after mlMapReadyCallbacks fire. */
const mlMapRef = { current: null as MaplibreMap | null };
const mlMapReadyCallbacks: (() => void)[] = [];

export function getMlMap(): MaplibreMap | null {
  return mlMapRef.current;
}

/** Register a callback to be called once (and immediately if already ready) when mlMap is loaded. */
export function onMlMapReady(cb: () => void): void {
  if (mlMapRef.current) {
    cb();
  } else {
    mlMapReadyCallbacks.push(cb);
  }
}

/** Reference to the currently active MapLibre-GL Leaflet layer. Never removed from the map. */
let activeBaseLayer: MaplibreGL | null = null;

/** Last known project points GeoJSON — re-applied after style switches. */
let lastProjectPointsGeojson: GeoJSON.FeatureCollection | null = null;

// Cached after first load — undefined until the user first uses satellite mode
let countryBorders: CountryBorder[] | undefined;

// Dynamically imports all country borders as a single chunk — only loads on first satellite use
async function ensureCountryBordersLoaded(): Promise<CountryBorder[]> {
  if (countryBorders) return countryBorders;

  const { borders: allBorders } = await import("@/assets/country-borders");

  const countryCodes = (Object.keys(satelliteLayerConfigs) as SatelliteLayerType[]).filter(
    (code): code is CountryCode => code !== "esri",
  );

  countryBorders = countryCodes.map((code) => ({
    code,
    geojson: allBorders[code] as FeatureCollection<Polygon | MultiPolygon>,
    bbox: toBoundingBox(countryBboxes[code]),
  }));

  return countryBorders;
}

/**
 * Fast check if point is within bounding box
 */
function isInBoundingBox(lat: number, lng: number, bbox: BoundingBox): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

/**
 * Ray casting algorithm for point-in-polygon detection
 * @param lat Point latitude
 * @param lng Point longitude
 * @param ring Polygon ring as array of [lng, lat] coordinates
 */
function isPointInPolygon(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  const x = lng;
  const y = lat;
  /* oxlint-disable no-non-null-assertion */
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;

    const intersect = yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!;
    if (intersect) inside = !inside;
  }
  /* oxlint-enable no-non-null-assertion */

  return inside;
}

/**
 * Check if a point is inside any of the country's polygons (ray-casting algorithm with hole support)
 */
function isPointInCountry(
  lat: number,
  lng: number,
  geojson: FeatureCollection<Polygon | MultiPolygon>,
): boolean {
  for (const feature of geojson.features) {
    if (feature.geometry.type === "MultiPolygon") {
      for (const polygon of feature.geometry.coordinates) {
        const outerRing = polygon[0];
        if (outerRing && isPointInPolygon(lat, lng, outerRing)) {
          let inHole = false;
          for (let i = 1; i < polygon.length; i += 1) {
            const hole = polygon[i];
            if (hole && isPointInPolygon(lat, lng, hole)) {
              inHole = true;
              break;
            }
          }
          if (!inHole) {
            return true;
          }
        }
      }
    } else {
      const outerRing = feature.geometry.coordinates[0];
      if (outerRing && isPointInPolygon(lat, lng, outerRing)) {
        let inHole = false;
        for (let i = 1; i < feature.geometry.coordinates.length; i += 1) {
          const hole = feature.geometry.coordinates[i];
          if (hole && isPointInPolygon(lat, lng, hole)) {
            inHole = true;
            break;
          }
        }
        if (!inHole) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Detect which country contains the given coordinates.
 * Async because the GeoJSON border data is lazy-loaded on first call.
 * @param lat Latitude
 * @param lng Longitude
 * @returns Country code or undefined if not in any known country
 */
async function detectCountryFromCoordinates(
  lat: number,
  lng: number,
): Promise<CountryCode | undefined> {
  const borders = await ensureCountryBordersLoaded();

  for (const country of borders) {
    // Fast bounding box pre-check (75x faster when outside)
    if (!isInBoundingBox(lat, lng, country.bbox)) {
      continue;
    }

    if (isPointInCountry(lat, lng, country.geojson)) {
      return country.code;
    }
  }
  return undefined;
}

/**
 * Add tile layers and layer control to the map
 */

export function addTileLayer(): void {
  // Check if tile layers were lost during hot reload
  if (!activeBaseLayer) {
    void addTileLayersToMap();
  }

  initEsriMetadataListener(); // Start listening for potential high-res availability
  initAutoCountrySwitchListener(); // Start listening for country-based satellite switching
}

/**
 * Initialize the MapLibre-GL Leaflet layer with the vector basemap.
 * The MapLibre layer is permanent — satellite mode changes its style via setStyle(),
 * it is never removed from the Leaflet map.
 */
async function addTileLayersToMap(): Promise<void> {
  try {
    const leafletLayer = maplibreLayer({ style: OPENFREEMAP_STYLE_URL }).addTo(map.value);
    activeBaseLayer = leafletLayer;

    const mlMap = leafletLayer.getMaplibreMap();
    mlMap.on("load", () => {
      mlMapRef.current = mlMap;

      // Sources must exist before subscribers are notified — callbacks like
      // projectPointsStore.init() call source.setData() immediately.
      addProjectSourcesToMap(mlMap);

      // Notify all waiting subscribers (e.g. vectorTileSync, projectPointsStore)
      for (const cb of mlMapReadyCallbacks) cb();
      mlMapReadyCallbacks.length = 0;
    });
  } catch (error) {
    console.error("Failed to initialize MapLibre tile layer:", error);
  }
}

const TILE_URL = `${getApiUrl()}/api/tiles/projects/{z}/{x}/{y}`;
const CLUSTER_MAX_ZOOM = 10;
const VECTOR_HOVER_HIT_RADIUS_PX = 6;

const HOVER_NONE_ID = "__none__";

const VECTOR_QUERY_LAYERS = [
  "overlay-footprints",
  "overlay-footprints-proposed-dashed",
  "project-shapes",
  "project-shapes-proposed-dashed",
] as const;

const CLICK_QUERY_LAYERS = ["clusters", ...VECTOR_QUERY_LAYERS, "unclustered-point"] as const;

type RenderedMapFeature = {
  properties?: Record<string, unknown>;
  sourceLayer?: string;
  geometry?: {
    coordinates?: any;
  };
};

const DEFAULT_PROJECT_LINE_COLOR = "#3b82f6";

const PROJECT_LINE_COLOR_BY_TAG: Record<string, string> = {};

for (const tag of PROJECT_TAGS) {
  PROJECT_LINE_COLOR_BY_TAG[tag.slug] = tag.color;
}

function getTagColorExpression(tagExpression: any[]): any[] {
  const expression: any[] = [
    "match",
    ["downcase", ["to-string", ["coalesce", ...tagExpression, ""]]],
  ];
  for (const [tag, color] of Object.entries(PROJECT_LINE_COLOR_BY_TAG)) {
    expression.push(tag, color);
  }
  expression.push(DEFAULT_PROJECT_LINE_COLOR);
  return expression;
}

function getProjectLineColorExpression(): any[] {
  return getTagColorExpression([["get", "first_tag"]]);
}

function getProjectPointColorExpression(): any[] {
  return getTagColorExpression([["get", "first_tag"]]);
}

function getIsProposedFilterExpression(): any[] {
  return ["any", ["==", ["get", "is_proposed"], true], ["==", ["get", "is_proposed"], 1]];
}

function buildClusterProperties(): Record<string, any[]> {
  const clusterProperties: Record<string, any[]> = {};

  for (const tag of PROJECT_TAGS) {
    clusterProperties[`tag_${tag.slug}`] = [
      "+",
      ["case", ["==", ["downcase", ["to-string", ["get", "first_tag"]]], tag.slug], 1, 0],
    ];
  }

  return clusterProperties;
}

function getSingleProjectClusterColorExpression(): any[] {
  const expression: any[] = ["case"];

  for (const tag of PROJECT_TAGS) {
    expression.push(["==", ["get", `tag_${tag.slug}`], 1], tag.color);
  }

  expression.push(DEFAULT_PROJECT_LINE_COLOR);
  return expression;
}

function getMaplibrePointFromLeafletEvent(
  event: L.LeafletMouseEvent,
  mlMap: MaplibreMap,
): {
  x: number;
  y: number;
} {
  return mlMap.project([event.latlng.lng, event.latlng.lat]);
}

function queryFeaturesAtLeafletEvent(
  event: L.LeafletMouseEvent,
  mlMap: MaplibreMap,
  layers: readonly string[],
  hitRadius: number,
): any[] {
  const point = getMaplibrePointFromLeafletEvent(event, mlMap);

  if (hitRadius > 0) {
    const bbox: [PointLike, PointLike] = [
      [point.x - hitRadius, point.y - hitRadius],
      [point.x + hitRadius, point.y + hitRadius],
    ];
    return mlMap.queryRenderedFeatures(bbox, { layers: [...layers] });
  }

  return mlMap.queryRenderedFeatures([point.x, point.y], { layers: [...layers] });
}

function getHoveredVectorId(feature: RenderedMapFeature | null): string {
  if (!feature) {
    return HOVER_NONE_ID;
  }

  const id = getFeaturePropertyAsString(feature, "id");
  return id.length > 0 ? id : HOVER_NONE_ID;
}

function setVectorHoverFilters(mlMap: MaplibreMap, feature: RenderedMapFeature | null): void {
  const hoveredId = getHoveredVectorId(feature);
  const m = mlMap as any;

  m.setFilter("project-shapes-hover", ["==", ["to-string", ["get", "id"]], hoveredId]);
  m.setFilter("project-shapes-proposed-hover", [
    "all",
    getIsProposedFilterExpression(),
    ["==", ["to-string", ["get", "id"]], hoveredId],
  ]);
  m.setFilter("overlay-footprints-hover", ["==", ["to-string", ["get", "id"]], hoveredId]);
  m.setFilter("overlay-footprints-proposed-hover", [
    "all",
    getIsProposedFilterExpression(),
    ["==", ["to-string", ["get", "id"]], hoveredId],
  ]);
}

function getVectorFeatureFromFeatures(features: any[]): RenderedMapFeature | null {
  const vectorFeature = features.find((feature) => {
    const sourceLayer = String(feature?.sourceLayer ?? "");
    return sourceLayer === "overlay-footprints" || sourceLayer === "project-shapes";
  });

  return vectorFeature ?? null;
}

function handleVectorFeatureClick(feature: RenderedMapFeature, latlng: L.LatLng): void {
  const sourceLayer = String(feature.sourceLayer ?? "");
  const projectId =
    sourceLayer === "overlay-footprints"
      ? getFeaturePropertyAsString(feature, "project_id")
      : getFeaturePropertyAsString(feature, "id");

  if (projectId.length === 0) {
    return;
  }

  handleProjectClickFromTile(projectId, latlng);
}

function setClusterHoverFilter(mlMap: MaplibreMap, clusterId: number | null): void {
  (mlMap as any).setFilter("clusters-hover", [
    "all",
    ["has", "point_count"],
    ["==", ["get", "cluster_id"], clusterId ?? -1],
  ]);
}

function registerHybridInteractionHandlers(_mlMap: MaplibreMap): void {
  map.value.on("mousemove", (event: L.LeafletMouseEvent) => {
    const mlMap = getMlMap();
    if (!mlMap) return;

    const features = queryFeaturesAtLeafletEvent(
      event,
      mlMap,
      CLICK_QUERY_LAYERS,
      VECTOR_HOVER_HIT_RADIUS_PX,
    );

    const clusterFeature = features.find((f) => f?.layer?.id === "clusters");
    setClusterHoverFilter(mlMap, clusterFeature?.properties?.cluster_id ?? null);

    mlMap.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    setVectorHoverFilters(mlMap, getVectorFeatureFromFeatures(features));
  });

  map.value.on("mouseout", () => {
    const mlMap = getMlMap();
    if (!mlMap) return;

    mlMap.getCanvas().style.cursor = "";
    setVectorHoverFilters(mlMap, null);
    setClusterHoverFilter(mlMap, null);
  });

  map.value.on("click", (event: L.LeafletMouseEvent) => {
    const mlMap = getMlMap();
    if (!mlMap) return;

    console.log("Map click at", event.latlng);
    const features = queryFeaturesAtLeafletEvent(
      event,
      mlMap,
      CLICK_QUERY_LAYERS,
      VECTOR_HOVER_HIT_RADIUS_PX,
    );
    if (!features.length) {
      return;
    }
    console.log(features.flatMap((f) => f?.properties));

    const clusterFeature = features.find((feature) => feature?.layer?.id === "clusters");
    if (clusterFeature) {
      const clusterId = clusterFeature.properties?.cluster_id;
      (mlMap.getSource("project-points") as any).getClusterExpansionZoom(
        clusterId,
        (err: any, zoom: number) => {
          if (err) return;
          mlMap.easeTo({ center: clusterFeature.geometry.coordinates, zoom });
        },
      );
      return;
    }

    const vectorFeature = getVectorFeatureFromFeatures(features);
    if (vectorFeature) {
      handleVectorFeatureClick(vectorFeature, event.latlng);
      return;
    }

    const unclusteredPoint = features.find((f) => f?.layer?.id === "unclustered-point");
    if (unclusteredPoint) {
      const projectId = String(unclusteredPoint.properties?.id ?? unclusteredPoint.id ?? "");
      if (projectId.length > 0) {
        handleProjectClickFromTile(projectId, event.latlng);
      }
    }
  });
}

function addFirstTagToProjectPointsGeojson(
  geojson: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const enrichedFeatures = [] as GeoJSON.Feature[];

  for (const feature of geojson.features) {
    const featureProps = (feature.properties ?? {}) as Record<string, unknown>;
    const existingFirstTag = featureProps["first_tag"];
    const tags = Array.isArray(featureProps["tags"])
      ? (featureProps["tags"] as unknown[])
      : ([] as unknown[]);
    const firstTagFromTags = typeof tags[0] === "string" ? String(tags[0]) : "";

    const firstTag =
      typeof existingFirstTag === "string" && existingFirstTag.length > 0
        ? existingFirstTag
        : firstTagFromTags;

    enrichedFeatures.push({
      ...feature,
      properties: {
        ...featureProps,
        first_tag: firstTag,
      },
    });
  }

  return {
    ...geojson,
    features: enrichedFeatures,
  };
}

function getFeaturePropertyAsString(feature: RenderedMapFeature, key: string): string {
  const value = feature.properties?.[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Add all project-related MapLibre sources and layers.
 * Called once from mlMap.on('load') and after every style switch.
 * Does NOT register interaction handlers (those are registered once at init).
 */
function addProjectDataToMlMap(mlMap: MaplibreMap): void {
  // Cast to any for addLayer/addSource calls that use complex expression arrays
  // which don't satisfy MapLibre's strict ExpressionSpecification type.
  const m = mlMap as any;

  // ── MVT source: project shapes + overlay footprints ───────────────────────
  m.addSource("project-sources", {
    type: "vector",
    tiles: [TILE_URL],
    minzoom: 0,
    maxzoom: 14,
    promoteId: { "overlay-footprints": "id", "project-shapes": "id" },
  });

  // Project geometry shapes (lines/polygons) — visible from zoom 9
  m.addLayer({
    id: "project-shapes",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: 9,
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": 2,
      "line-dasharray": [4, 1.5],
    },
  });

  // Proposed project shapes are overlaid as dashed lines.
  m.addLayer({
    id: "project-shapes-proposed-dashed",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: 9,
    filter: getIsProposedFilterExpression(),
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": 2,
      "line-dasharray": [2, 1.5],
    },
  });

  // Hover highlight for project shapes.
  m.addLayer({
    id: "project-shapes-hover",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: 9,
    filter: ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
    paint: {
      "line-color": "#ffffff",
      "line-width": 4,
      "line-opacity": 0.8,
    },
  });

  m.addLayer({
    id: "project-shapes-proposed-hover",
    type: "line",
    source: "project-sources",
    "source-layer": "project-shapes",
    minzoom: 9,
    filter: [
      "all",
      getIsProposedFilterExpression(),
      ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
    ],
    paint: {
      "line-color": "#ffffff",
      "line-width": 4,
      "line-opacity": 0.8,
      "line-dasharray": [2, 1.5],
    },
  });

  // Overlay footprints — permanent border outline replacing CSS box-shadow hack
  // minzoom: 13 (MapLibre) = Leaflet zoom 14 = MIN_ZOOM_FOR_OVERLAYS.
  // maplibre-gl-leaflet applies a -1 offset (512px vs 256px tile size), so
  // MapLibre zoom N corresponds to Leaflet zoom N+1.
  m.addLayer({
    id: "overlay-footprints",
    type: "line",
    source: "project-sources",
    "source-layer": "overlay-footprints",
    minzoom: 13,
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": 1.5,
      "line-opacity": 0.7,
    },
  });

  // Proposed overlay footprints inherit proposed state from their parent project.
  m.addLayer({
    id: "overlay-footprints-proposed-dashed",
    type: "line",
    source: "project-sources",
    "source-layer": "overlay-footprints",
    minzoom: 13,
    filter: getIsProposedFilterExpression(),
    paint: {
      "line-color": getProjectLineColorExpression(),
      "line-width": 1.5,
      "line-opacity": 0.7,
      "line-dasharray": [2, 1.5],
    },
  });

  m.addLayer({
    id: "overlay-footprints-hover",
    type: "line",
    source: "project-sources",
    "source-layer": "overlay-footprints",
    minzoom: 13,
    filter: ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
    paint: {
      "line-color": "#ffffff",
      "line-width": 3.5,
      "line-opacity": 0.9,
    },
  });

  m.addLayer({
    id: "overlay-footprints-proposed-hover",
    type: "line",
    source: "project-sources",
    "source-layer": "overlay-footprints",
    minzoom: 13,
    filter: [
      "all",
      getIsProposedFilterExpression(),
      ["==", ["to-string", ["get", "id"]], HOVER_NONE_ID],
    ],
    paint: {
      "line-color": "#ffffff",
      "line-width": 3.5,
      "line-opacity": 0.9,
      "line-dasharray": [2, 1.5],
    },
  });

  // ── GeoJSON cluster source: project center coordinates ────────────────────
  // Populated immediately if data is already cached, otherwise by updateProjectPointsSource()
  m.addSource("project-points", {
    type: "geojson",
    data: lastProjectPointsGeojson
      ? addFirstTagToProjectPointsGeojson(lastProjectPointsGeojson)
      : { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: 50,
    clusterProperties: buildClusterProperties(),
  });

  // Cluster circles
  m.addLayer({
    id: "clusters",
    type: "circle",
    source: "project-points",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "case",
        ["==", ["get", "point_count"], 1],
        getSingleProjectClusterColorExpression(),
        ["step", ["get", "point_count"], "#3b82f6", 10, "#1d4ed8", 50, "#1e3a8a"],
      ],
      "circle-radius": ["step", ["get", "point_count"], 11, 10, 16, 50, 21],
      "circle-opacity": 0.85,
    },
  });

  // Cluster hover highlight — lighter fill, filter updated dynamically on mousemove
  m.addLayer({
    id: "clusters-hover",
    type: "circle",
    source: "project-points",
    filter: ["all", ["has", "point_count"], ["==", ["get", "cluster_id"], -1]],
    paint: {
      "circle-color": [
        "case",
        ["==", ["get", "point_count"], 1],
        getSingleProjectClusterColorExpression(),
        ["step", ["get", "point_count"], "#60a5fa", 10, "#3b82f6", 50, "#1d4ed8"],
      ],
      "circle-radius": ["step", ["get", "point_count"], 11, 10, 16, 50, 21],
      "circle-opacity": 1,
    },
  });

  // Cluster count labels
  m.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "project-points",
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-size": 12,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "#ffffff" },
  });

  // Individual unclustered points — visible between clusterMaxZoom and zoom 13
  m.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "project-points",
    filter: ["!", ["has", "point_count"]],
    minzoom: CLUSTER_MAX_ZOOM,
    paint: {
      "circle-color": getProjectPointColorExpression(),
      "circle-radius": 6,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
}

/**
 * Called once from mlMap.on('load'). Adds project data and registers interaction handlers.
 */
function addProjectSourcesToMap(mlMap: MaplibreMap): void {
  addProjectDataToMlMap(mlMap);
  registerHybridInteractionHandlers(mlMap);
}

/**
 * Update the project-points GeoJSON source with fresh data.
 * Called after /api/projects/points is fetched (and on filter changes).
 */
export function updateProjectPointsSource(geojson: GeoJSON.FeatureCollection): void {
  lastProjectPointsGeojson = geojson;
  const mlMap = mlMapRef.current;
  if (!mlMap) return;
  const source = mlMap.getSource("project-points");
  if (source) {
    (source as any).setData(addFirstTagToProjectPointsGeojson(geojson));
  }
}

/**
 * Build a minimal MapLibre style containing only the given satellite raster source.
 * Project data layers are re-added on top after the style loads.
 */
function buildSatelliteStyle(layerType: SatelliteLayerType): StyleSpecification {
  const config = satelliteLayerConfigs[layerType];
  return {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles: config.tiles,
        tileSize: config.tileSize,
        attribution: config.attribution,
        maxzoom: config.maxZoom,
      },
    },
    layers: [{ id: "satellite", type: "raster", source: "satellite" }],
  };
}

/**
 * Switch the MapLibre map to a new style, then re-add project data on top.
 * Temporarily nulls mlMapRef.current so event handlers bail during the transition.
 */
async function switchToStyle(style: StyleSpecification | string): Promise<void> {
  const mlMap = mlMapRef.current;
  if (!mlMap) return;

  mlMapRef.current = null; // Disable event handlers during style transition

  await new Promise<void>((resolve) => {
    mlMap.once("style.load", () => {
      addProjectDataToMlMap(mlMap);
      mlMapRef.current = mlMap;
      resolve();
    });
    mlMap.setStyle(style);
  });
}

/**
 * Switch to a different tile layer (for custom layer control)
 */
export async function switchTileLayer(layerType: TileLayerType): Promise<void> {
  // Optimization: If switching to satellite, check if we should directly go to a country layer
  // This prevents loading ESRI first then immediately switching (avoiding "flash" and wasted requests)
  let resolvedLayerType = layerType;
  if (layerType === "esri") {
    const currentZoom = map.value.getZoom();
    if (currentZoom > MAP_CONFIG.MIN_ZOOM_FOR_COUNTRY_LAYERS) {
      const center = map.value.getCenter();
      const detectedCountry = await detectCountryFromCoordinates(center.lat, center.lng);
      if (detectedCountry && isTileLayerType(detectedCountry)) {
        resolvedLayerType = detectedCountry;
      }
    }
  }

  if (currentTileLayer.value === resolvedLayerType) {
    return;
  }

  currentTileLayer.value = resolvedLayerType;

  if (resolvedLayerType === "plan") {
    await switchToStyle(OPENFREEMAP_STYLE_URL);
  } else {
    await switchToStyle(buildSatelliteStyle(resolvedLayerType));
  }

  if (resolvedLayerType === "esri") {
    void checkEsriMaxZoom();
  }
}

export function isTileLayerType(value: string): value is TileLayerType {
  return value === "plan" || Object.hasOwn(satelliteLayerConfigs, value);
}

// Debounce timer for metadata queries
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Cache for max zoom at locations to prevent repeated queries
// Key: "lat,lng" rounded to ~100m, Value: maxZoom
const maxZoomCache = new Map<string, number>();

/**
 * Query Esri Metadata to look for high-resolution imagery availability
 * and dynamically adjust the maxzoom.
 */
async function checkEsriMaxZoom() {
  if (currentTileLayer.value !== "esri") return;

  const center = map.value.getCenter();
  const zoom = map.value.getZoom();

  if (zoom < 16) return;

  const cacheKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
  const cachedMaxZoom = maxZoomCache.get(cacheKey);
  if (cachedMaxZoom !== undefined) {
    applyEsriMaxZoom(cachedMaxZoom);
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    try {
      const maxZoom = await fetchEsriMaxZoom(center.lat, center.lng);
      if (maxZoom) {
        maxZoomCache.set(cacheKey, maxZoom);
        applyEsriMaxZoom(maxZoom);
      }
    } catch (error) {
      console.warn("Failed to fetch Esri metadata", error);
    }
  }, 500);
}

function applyEsriMaxZoom(zoomLevel: number) {
  const esriConfig = satelliteLayerConfigs.esri;

  if (esriConfig.maxZoom !== zoomLevel) {
    esriConfig.maxZoom = zoomLevel;

    if (currentTileLayer.value === "esri") {
      const mlMap = getMlMap();
      if (mlMap) {
        // Since MapLibre GL JS does not officially support hot-swapping maxzoom on a source
        // we'll attempt to update it via undocumented properties.
        const source = mlMap.getSource("satellite");
        if (source) {
          (source as any).maxzoom = zoomLevel;
          try {
            // Try to force the style source cache to update
            const sourceCache = (mlMap.style as any).sourceCaches["satellite"];
            if (sourceCache) {
              sourceCache.clearTiles();
              sourceCache.update((mlMap as any).transform);
            }
          } catch (e) {
            // ignore
          }
          mlMap.triggerRepaint();
        }
      }
    }
  }
}

// Interface for Esri Identify Response
interface EsriIdentifyResponse {
  results?: {
    attributes: {
      MaxMapLevel?: string;
      [key: string]: any;
    };
  }[];
}

/**
 * ESRI has diffent max native zoom depending on the location
 */
async function fetchEsriMaxZoom(lat: number, lng: number): Promise<number | null> {
  const bounds = map.value.getBounds();
  const extent = {
    xmin: bounds.getWest(),
    ymin: bounds.getSouth(),
    xmax: bounds.getEast(),
    ymax: bounds.getNorth(),
    spatialReference: { wkid: 4326 },
  };

  const url = new URL(
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify",
  );
  url.searchParams.append("f", "json");
  url.searchParams.append("geometry", `${lng},${lat}`);
  url.searchParams.append("geometryType", "esriGeometryPoint");
  url.searchParams.append("sr", "4326");
  url.searchParams.append("layers", "top");
  url.searchParams.append("tolerance", "2");
  url.searchParams.append(
    "mapExtent",
    `${extent.xmin},${extent.ymin},${extent.xmax},${extent.ymax}`,
  );
  url.searchParams.append("imageDisplay", "600,400,96");
  url.searchParams.append("returnGeometry", "false");

  const response = await fetch(url.toString());
  const data = (await response.json()) as EsriIdentifyResponse | null;

  if (data?.results) {
    const firstEsriResult = data.results[0];
    if (!firstEsriResult) return BASELINE_ESRI_MAX_ZOOM;

    const attributes = firstEsriResult.attributes;

    if (attributes.MaxMapLevel) {
      const maxLevel = Number.parseInt(attributes.MaxMapLevel, 10);
      if (!Number.isNaN(maxLevel)) {
        return Math.min(maxLevel, 22);
      }
    }
  }

  return null;
}

/**
 * Automatically switch satellite layer based on map view location and zoom
 */
async function checkAndAutoSwitchSatelliteLayer() {
  if (currentTileLayer.value === "plan") {
    return;
  }

  const currentZoom = map.value.getZoom();

  if (currentZoom <= MAP_CONFIG.MIN_ZOOM_FOR_COUNTRY_LAYERS) {
    if (currentTileLayer.value !== "esri") {
      await switchTileLayer("esri");
    }
    return;
  }

  const center = map.value.getCenter();
  const detectedCountry: CountryCode | undefined = await detectCountryFromCoordinates(
    center.lat,
    center.lng,
  );

  const targetLayer: TileLayerType =
    detectedCountry && isTileLayerType(detectedCountry) ? detectedCountry : "esri";

  if (currentTileLayer.value !== targetLayer) {
    await switchTileLayer(targetLayer);
  }
}

/**
 * Initialize listener for automatic country-based satellite switching
 */
function initAutoCountrySwitchListener() {
  map.value.on("moveend", () => {
    void checkAndAutoSwitchSatelliteLayer();
  });
}

function initEsriMetadataListener() {
  map.value.on("moveend", () => {
    void checkEsriMaxZoom();
  });
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
