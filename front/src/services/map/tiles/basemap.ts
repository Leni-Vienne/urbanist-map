import { ref, watch } from "vue";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type {
  AllPaintProperties,
  GeoJSONSource,
  Map as MaplibreMap,
  RasterSourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import {
  getMap,
  getMapOrNull,
  OPENFREEMAP_STYLE_URL,
  markMapReady,
  emitStyleSwitch,
} from "@/services/core/map";
import { MAP_CONFIG } from "@/constants/mapConstants";
import countryBboxes from "@/assets/country_bboxes.json";

import { t } from "@/locales";
import {
  addProjectDataToMlMap,
  initializeHybridInteractionHandlers,
  applyTagFiltersToVectorLayers,
} from "./layers";
import {
  applyPlanStyleRoadOverrides,
  applyPoiVisibilityOverrides,
  applyRailStyleOverrides,
  applySky,
} from "../basemapStyleOverrides";
import { applyMapLabelLanguage } from "../mapLabelLanguage";
import { show3DBuildings } from "@/services/core/settings";
import {
  selectedProjectTags,
  selectedStatusFilters,
  sizeFilterRange,
  selectedNameFilter,
  lastModifiedDateRange,
  showOnlyWithImages,
} from "@/services/core/filters";
import { syncOverlaysFromTiles } from "@/services/map/tiles/sync";
import { toastError } from "@/services/core/toast";

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

// Helper to convert a bbox array to a BoundingBox object
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
    maxZoom: 21, // there is a level 22 but it's the same quality as 21
  },
};

// Derived types, adding a country only requires a new entry in satelliteLayerConfigs above
type SatelliteLayerType = keyof typeof satelliteLayerConfigs;
type CountryCode = Exclude<SatelliteLayerType, "esri">;
export type TileLayerType = "plan" | SatelliteLayerType;

// Current active tile layer ("plan" = MapLibre vector basemap)
export const currentTileLayer = ref<TileLayerType>("plan");

// Original extrusion height/base expressions per layer, captured before flattening
// so 3D can be restored on toggle-back.
const originalExtrusionPaint = new Map<
  string,
  {
    height: AllPaintProperties["fill-extrusion-height"];
    base: AllPaintProperties["fill-extrusion-base"];
  }
>();

/**
 * Switch the basemap's buildings between 3D extrusion and flat footprints.
 * Liberty's flat "building" fill only renders at z13-14; past z14 the footprint
 * exists solely as the "building-3d" extrusion. So we flatten the extrusion to
 * height 0 (keeping the footprint) rather than hiding it, which would leave no
 * buildings when zoomed in. Satellite styles have no fill-extrusion layers.
 */
function applyBuildings3DState(extruded: boolean): void {
  const mlMap = getMapOrNull();
  if (!mlMap) return;
  for (const layer of mlMap.getStyle().layers) {
    if (layer.type !== "fill-extrusion") continue;

    if (!originalExtrusionPaint.has(layer.id)) {
      originalExtrusionPaint.set(layer.id, {
        height: mlMap.getPaintProperty(layer.id, "fill-extrusion-height"),
        base: mlMap.getPaintProperty(layer.id, "fill-extrusion-base"),
      });
    }

    if (extruded) {
      const original = originalExtrusionPaint.get(layer.id);
      mlMap.setPaintProperty(layer.id, "fill-extrusion-height", original?.height);
      mlMap.setPaintProperty(layer.id, "fill-extrusion-base", original?.base);
    } else {
      mlMap.setPaintProperty(layer.id, "fill-extrusion-height", 0);
      mlMap.setPaintProperty(layer.id, "fill-extrusion-base", 0);
    }
  }
}

// Cached after first load, undefined until the user first uses satellite mode
let countryBorders: CountryBorder[] | undefined = undefined;

let lastPendingProjectPointsGeojson: GeoJSON.FeatureCollection | null = null;
let lastPendingProjectShapesGeojson: GeoJSON.FeatureCollection | null = null;

// Dynamically imports all country borders as a single chunk, only loads on first satellite use
async function ensureCountryBordersLoaded(): Promise<CountryBorder[]> {
  if (countryBorders) return countryBorders;

  const { borders: allBorders } = await import("@/assets/country-borders");

  const countryCodes = Object.keys(satelliteLayerConfigs).filter(
    (code): code is CountryCode => code !== "esri",
  );

  countryBorders = countryCodes.map((code) => ({
    code,
    /* oxlint-disable-next-line no-unsafe-type-assertion */
    geojson: allBorders[code] as FeatureCollection<Polygon | MultiPolygon>,
    bbox: toBoundingBox(countryBboxes[code]),
  }));

  return countryBorders;
}

/** Fast check: is the given point within this bounding box? */
function isInBoundingBox(lat: number, lng: number, bbox: BoundingBox): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

/**
 * Ray-casting algorithm for point-in-polygon detection.
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
 * Check if a point is inside a single polygon: within its outer ring (`rings[0]`) and outside
 * every hole that follows.
 */
function isPointInRings(lat: number, lng: number, rings: number[][][]): boolean {
  const outerRing = rings[0];
  if (!outerRing || !isPointInPolygon(lat, lng, outerRing)) return false;
  for (let i = 1; i < rings.length; i += 1) {
    const hole = rings[i];
    if (hole && isPointInPolygon(lat, lng, hole)) return false;
  }
  return true;
}

/**
 * Check if a point is inside any of the country's polygons (hole support included).
 */
function isPointInCountry(
  lat: number,
  lng: number,
  geojson: FeatureCollection<Polygon | MultiPolygon>,
): boolean {
  for (const feature of geojson.features) {
    const polygons =
      feature.geometry.type === "MultiPolygon"
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];
    if (polygons.some((rings) => isPointInRings(lat, lng, rings))) return true;
  }
  return false;
}

/**
 * Detect which country contains the given coordinates.
 * Async because the GeoJSON border data is lazy-loaded on first call.
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

/** Run a callback once the map style is loaded (immediately if it already is). */
function whenStyleLoaded(mlMap: MaplibreMap, cb: () => void): () => void {
  if (mlMap.isStyleLoaded()) {
    cb();
    return () => undefined;
  }
  // style.load fires once the style JSON is parsed, before the initial basemap tiles finish
  // downloading, so the backend tile source registers and fetches in parallel. "idle" is a
  // fallback covering the window where style.load has already fired but sources are still
  // loading (isStyleLoaded() false), which a once("style.load") registered late would miss.
  let active = true;
  function runOnce(): void {
    if (!active) return;
    stop();
    cb();
  }
  function stop(): void {
    active = false;
    mlMap.off("style.load", runOnce);
    mlMap.off("idle", runOnce);
  }
  mlMap.on("style.load", runOnce);
  mlMap.on("idle", runOnce);
  return stop;
}

/**
 * Drop the pending-source payloads replayed onto a new style, so a new map starts with empty
 * pending sources instead of the previous mount's session content.
 */
function clearPendingProjectSourceCache(): void {
  lastPendingProjectPointsGeojson = null;
  lastPendingProjectShapesGeojson = null;
}

/** Rebuild the application layers on either the initial style or a replacement. */
function initializeStyle(mlMap: MaplibreMap, plan: boolean): void {
  try {
    if (plan) {
      applyPlanStyleRoadOverrides(mlMap);
      applyRailStyleOverrides(mlMap);
      applyPoiVisibilityOverrides(mlMap);
      applySky(mlMap);
      applyMapLabelLanguage(mlMap);
      applyBuildings3DState(show3DBuildings.value);
    }
    addProjectDataToMlMap(mlMap);

    initializeHybridInteractionHandlers();

    if (lastPendingProjectPointsGeojson) {
      updatePendingProjectPointsSource(lastPendingProjectPointsGeojson);
    }
    if (lastPendingProjectShapesGeojson) {
      updatePendingProjectShapesSource(lastPendingProjectShapesGeojson);
    }
    markMapReady(mlMap);
  } catch (error) {
    console.error("Failed to initialize MapLibre project layers:", error);
    toastError(error instanceof Error ? error.message : undefined, t("errors.mapInitFailed"));
  }
}

function refreshProjectFilters(): void {
  const mlMap = getMapOrNull();
  if (!mlMap) return;
  applyTagFiltersToVectorLayers(mlMap);
  // querySourceFeatures bypasses setFilter, so resync overlay images explicitly.
  syncOverlaysFromTiles();
}

watch(
  [
    selectedProjectTags,
    selectedStatusFilters,
    sizeFilterRange,
    selectedNameFilter,
    lastModifiedDateRange,
    showOnlyWithImages,
  ],
  refreshProjectFilters,
);

watch(show3DBuildings, (extruded) => {
  applyBuildings3DState(extruded);
});

/** Update the pending-project-points source with fresh GeoJSON data (edit/moderation mode). */
export function updatePendingProjectPointsSource(geojson: GeoJSON.FeatureCollection): void {
  lastPendingProjectPointsGeojson = geojson;

  const source = getMapOrNull()?.getSource<GeoJSONSource>("pending-project-points-source");
  if (source) {
    void source.setData(geojson);
  }
}

/** Update the pending-project-shapes source with fresh GeoJSON data (edit/moderation mode). */
export function updatePendingProjectShapesSource(geojson: GeoJSON.FeatureCollection): void {
  lastPendingProjectShapesGeojson = geojson;

  const source = getMapOrNull()?.getSource<GeoJSONSource>("pending-project-shapes-source");
  if (source) {
    void source.setData(geojson);
  }
}

/**
 * Build a minimal MapLibre style containing only the given satellite raster source.
 * Project data layers are re-added on top after the style loads.
 */
function buildSatelliteSourceSpec(
  layerType: SatelliteLayerType,
  esriMaxZoom: number,
): RasterSourceSpecification {
  const config = satelliteLayerConfigs[layerType];
  // Esri's usable max zoom varies by location and is refined at runtime; all other
  // layers use their fixed configured maxZoom.
  const maxzoom = layerType === "esri" ? esriMaxZoom : config.maxZoom;
  return {
    type: "raster",
    tiles: config.tiles,
    tileSize: config.tileSize,
    attribution: config.attribution,
    maxzoom,
  };
}

function buildSatelliteStyle(
  layerType: SatelliteLayerType,
  esriMaxZoom: number,
): StyleSpecification {
  return {
    version: 8,
    // Renders the project-points-count text-field with the same server-side Noto Sans Bold
    // as the plan style; without it MapLibre falls back to locally drawn TinySDF glyphs.
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      satellite: buildSatelliteSourceSpec(layerType, esriMaxZoom),
    },
    layers: [{ id: "satellite", type: "raster", source: "satellite" }],
  };
}

// Only this pointer is shared; requests, timers and style listeners belong to one map.
let activeBasemap: {
  switchLayer: (layer: TileLayerType) => Promise<void>;
  stop: () => void;
} | null = null;
// Location metadata is reusable across mounts; the applied source resolution is not.
const maxZoomCache = new Map<string, number>();

/** Own initial style setup, satellite switching and metadata requests until map teardown. */
export function addTileLayer(): () => void {
  activeBasemap?.stop();
  const target = getMap();
  let stopped = false;
  let layerRequest = 0;
  let esriMaxZoom = BASELINE_ESRI_MAX_ZOOM;
  let stopInitialStyle: (() => void) | null = null;
  let stopStyleSwitch: (() => void) | null = null;
  let metadataTimer: ReturnType<typeof setTimeout> | null = null;
  let metadataRequest: AbortController | null = null;

  function isCurrent(): boolean {
    return !stopped && getMapOrNull() === target;
  }

  function cancelMetadata(): void {
    if (metadataTimer !== null) clearTimeout(metadataTimer);
    metadataTimer = null;
    metadataRequest?.abort();
    metadataRequest = null;
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cancelMetadata();
    stopInitialStyle?.();
    stopStyleSwitch?.();
    target.off("moveend", onMoveEnd);
    if (activeBasemap === owner) {
      activeBasemap = null;
      clearPendingProjectSourceCache();
      originalExtrusionPaint.clear();
    }
  }

  // Cancelling a switch also settles its caller; removing the map must not leave
  // a UI action awaiting a style.load event that can no longer arrive.
  function switchToStyle(style: StyleSpecification | string): Promise<void> {
    // A user can choose satellite before the initial plan style finishes loading.
    // Only the incoming style may initialize the application layers in that case.
    stopInitialStyle?.();
    stopInitialStyle = null;
    stopStyleSwitch?.();
    return new Promise<void>((resolve, reject) => {
      function cleanup(): void {
        target.off("style.load", onLoad);
        stopStyleSwitch = null;
      }
      function cancel(): void {
        cleanup();
        resolve();
      }
      function onLoad(): void {
        if (stopStyleSwitch !== cancel) return;
        cleanup();
        if (!isCurrent()) {
          resolve();
          return;
        }
        try {
          initializeStyle(target, style === OPENFREEMAP_STYLE_URL);
          emitStyleSwitch("after");
          checkEsriMaxZoom();
        } finally {
          resolve();
        }
      }
      stopStyleSwitch = cancel;
      target.on("style.load", onLoad);
      try {
        emitStyleSwitch("before");
        target.setStyle(style);
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async function resolveSatelliteLayer(): Promise<SatelliteLayerType> {
    if (target.getZoom() <= MAP_CONFIG.MIN_ZOOM_FOR_COUNTRY_LAYERS) return "esri";
    const center = target.getCenter();
    return (await detectCountryFromCoordinates(center.lat, center.lng)) ?? "esri";
  }

  async function switchLayer(layerType: TileLayerType): Promise<void> {
    if (!isCurrent()) return;
    layerRequest += 1;
    const request = layerRequest;
    cancelMetadata();
    // Resolve country imagery before changing styles so there is no intermediate Esri flash.
    const resolved = layerType === "esri" ? await resolveSatelliteLayer() : layerType;
    if (!isCurrent() || request !== layerRequest) return;
    if (currentTileLayer.value !== resolved) {
      currentTileLayer.value = resolved;
      await switchToStyle(
        resolved === "plan" ? OPENFREEMAP_STYLE_URL : buildSatelliteStyle(resolved, esriMaxZoom),
      );
    }
    if (isCurrent() && request === layerRequest) checkEsriMaxZoom();
  }

  function applyEsriMaxZoom(zoom: number): void {
    if (!isCurrent() || currentTileLayer.value !== "esri" || !target.getSource("satellite")) return;
    if (esriMaxZoom === zoom) return;
    esriMaxZoom = zoom;
    const bottomLayerId = target.getStyle().layers.find((layer) => layer.id !== "satellite")?.id;
    if (target.getLayer("satellite")) target.removeLayer("satellite");
    target.removeSource("satellite");
    target.addSource("satellite", buildSatelliteSourceSpec("esri", esriMaxZoom));
    target.addLayer({ id: "satellite", type: "raster", source: "satellite" }, bottomLayerId);
  }

  function checkEsriMaxZoom(): void {
    cancelMetadata();
    if (
      !isCurrent() ||
      currentTileLayer.value !== "esri" ||
      target.getZoom() < 15 ||
      !target.getSource("project-sources")
    )
      return;
    const center = target.getCenter();
    const key = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
    const cached = maxZoomCache.get(key);
    if (cached !== undefined) {
      applyEsriMaxZoom(cached);
      return;
    }
    metadataTimer = setTimeout(() => void fetchMetadata(), 500);

    async function fetchMetadata(): Promise<void> {
      metadataTimer = null;
      if (!isCurrent()) return;
      const request = new AbortController();
      metadataRequest = request;
      try {
        const maxZoom = await fetchEsriMaxZoom(target, center.lat, center.lng, request.signal);
        if (request.signal.aborted || !isCurrent()) return;
        maxZoomCache.set(key, maxZoom);
        applyEsriMaxZoom(maxZoom);
      } catch (error) {
        if (!request.signal.aborted) console.warn("Failed to fetch Esri metadata", error);
      } finally {
        if (metadataRequest === request) metadataRequest = null;
      }
    }
  }

  function onMoveEnd(): void {
    if (currentTileLayer.value === "plan") return;
    void switchLayer("esri").catch((error: unknown) => {
      if (isCurrent()) console.warn("Failed to switch satellite layer", error);
    });
  }

  const owner = { switchLayer, stop };
  activeBasemap = owner;
  currentTileLayer.value = "plan";
  originalExtrusionPaint.clear();
  try {
    target.setMissingStyleImageResolver((id) => {
      target.addImage(id, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
    });
    target.on("moveend", onMoveEnd);
    stopInitialStyle = whenStyleLoaded(target, () => {
      if (isCurrent()) initializeStyle(target, true);
    });
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

/** Switch only the mounted map; continuations from an older owner are inert. */
export async function switchTileLayer(layer: TileLayerType): Promise<void> {
  await activeBasemap?.switchLayer(layer);
}

// Interface for the Esri Identify API response
interface EsriIdentifyResponse {
  results?: {
    attributes: { MaxMapLevel?: string };
  }[];
}

/** Queries the ESRI Identify API to get the max native zoom level at the given location. */
async function fetchEsriMaxZoom(
  target: MaplibreMap,
  lat: number,
  lng: number,
  signal: AbortSignal,
): Promise<number> {
  const bounds = target.getBounds();
  const extent = {
    xmin: bounds.getWest(),
    ymin: bounds.getSouth(),
    xmax: bounds.getEast(),
    ymax: bounds.getNorth(),
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

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) return BASELINE_ESRI_MAX_ZOOM;
  // oxlint-disable-next-line no-unsafe-type-assertion
  const data = (await response.json()) as EsriIdentifyResponse | null;

  const maxMapLevel = data?.results?.[0]?.attributes.MaxMapLevel;
  if (maxMapLevel) {
    const maxLevel = Number.parseInt(maxMapLevel, 10);
    if (!Number.isNaN(maxLevel)) {
      return Math.min(maxLevel, 22);
    }
  }

  // No usable metadata for this location: fall back to (and cache) the safe baseline so
  // moveend doesn't re-fetch forever here.
  return BASELINE_ESRI_MAX_ZOOM;
}
