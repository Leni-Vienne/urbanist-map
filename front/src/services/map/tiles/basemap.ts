import { ref, watch } from "vue";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type {
  GeoJSONSource,
  Map as MaplibreMap,
  RasterSourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { getMap, getMapOrNull, OPENFREEMAP_STYLE_URL, markMapReady } from "@/services/core/map";
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
import { dropImageHandlesForStyleSwitch } from "@/services/overlay/mapLayers";
import { reattachEditHandlesAfterStyleSwitch } from "@/services/overlay/editing";
import { show3DBuildings } from "@/services/map/settings";
import {
  selectedProjectTags,
  selectedStatusFilters,
  sizeFilterRange,
  selectedNameFilters,
  lastModifiedDateRange,
  showOnlyWithImages,
} from "@/services/map/filters";
import { runViewportRenderLoop } from "@/services/map/viewportRenderLoop";
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

// Live Esri max native zoom for the current location, refined at runtime from the Esri
// metadata API. Kept separate from the static satelliteLayerConfigs entry so the config
// stays immutable.
let currentEsriMaxZoom = BASELINE_ESRI_MAX_ZOOM;

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
const originalExtrusionPaint = new Map<string, { height: unknown; base: unknown }>();

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
 * Check if a point is inside any of the country's polygons (hole support included).
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
function whenStyleLoaded(mlMap: MaplibreMap, cb: () => void): void {
  if (mlMap.isStyleLoaded()) {
    cb();
    return;
  }
  // style.load fires once the style JSON is parsed, before the initial basemap tiles finish
  // downloading, so the backend tile source registers and fetches in parallel. "idle" is a
  // fallback covering the window where style.load has already fired but sources are still
  // loading (isStyleLoaded() false), which a once("style.load") registered late would miss.
  let ran = false;
  function runOnce(): void {
    if (ran) return;
    ran = true;
    cb();
  }
  void mlMap.once("style.load", runOnce);
  void mlMap.once("idle", runOnce);
}

/**
 * Initialize the map's project data layers and interaction once the basemap style is ready. A fresh
 * map always boots on the plan style, so the tile-layer selection resets with it.
 */
export function addTileLayer(): void {
  const mlMap = getMap();
  currentTileLayer.value = "plan";

  // A dummy image prevents "styleimagemissing" errors for missing cluster icons.
  // Registered once; the handler persists across setStyle() satellite switches.
  mlMap.on("styleimagemissing", (e: { id: string }) => {
    mlMap.addImage(e.id, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
  });

  whenStyleLoaded(mlMap, () => {
    onFirstStyleReady(mlMap);
  });

  initSatelliteMoveEndListener(mlMap);
}

/**
 * Drop the pending-source payloads replayed onto a new style, so a new map starts with empty
 * pending sources instead of the previous mount's session content.
 */
export function clearPendingProjectSourceCache(): void {
  lastPendingProjectPointsGeojson = null;
  lastPendingProjectShapesGeojson = null;
}

/** Wire up project data + interaction on first style load, then mark the map ready. */
function onFirstStyleReady(mlMap: MaplibreMap): void {
  try {
    applyPlanStyleRoadOverrides(mlMap);
    applyRailStyleOverrides(mlMap);
    applyPoiVisibilityOverrides(mlMap);
    applySky(mlMap);
    applyMapLabelLanguage(mlMap);
    addProjectDataToMlMap(mlMap);

    initializeHybridInteractionHandlers();

    markMapReady(mlMap);

    applyBuildings3DState(show3DBuildings.value);

    if (lastPendingProjectPointsGeojson) {
      updatePendingProjectPointsSource(lastPendingProjectPointsGeojson);
    }
    if (lastPendingProjectShapesGeojson) {
      updatePendingProjectShapesSource(lastPendingProjectShapesGeojson);
    }
  } catch (error) {
    console.error("Failed to initialize MapLibre project layers:", error);
    toastError(error instanceof Error ? error.message : undefined, t("errors.mapInitFailed"));
  }
}

// Watch for tag and status filter changes and update MVT layers on the map
watch(
  [
    selectedProjectTags,
    selectedStatusFilters,
    sizeFilterRange,
    selectedNameFilters,
    lastModifiedDateRange,
    showOnlyWithImages,
  ],
  () => {
    const mlMap = getMapOrNull();
    if (!mlMap) return;
    applyTagFiltersToVectorLayers(mlMap);
    // setFilter handles the vector layers; this evicts overlay images filtered out by the
    // tag/status/name/date filters (querySourceFeatures bypasses setFilter).
    syncOverlaysFromTiles();
  },
);

watch(show3DBuildings, (extruded) => {
  applyBuildings3DState(extruded);
});

/** Update the pending-project-points source with fresh GeoJSON data (edit/moderation mode). */
export function updatePendingProjectPointsSource(geojson: GeoJSON.FeatureCollection): void {
  lastPendingProjectPointsGeojson = geojson;

  const source = getMapOrNull()?.getSource<GeoJSONSource>("pending-project-points-source");
  if (source) {
    source.setData(geojson);
  }
}

/** Update the pending-project-shapes source with fresh GeoJSON data (edit/moderation mode). */
export function updatePendingProjectShapesSource(geojson: GeoJSON.FeatureCollection): void {
  lastPendingProjectShapesGeojson = geojson;

  const source = getMapOrNull()?.getSource<GeoJSONSource>("pending-project-shapes-source");
  if (source) {
    source.setData(geojson);
  }
}

/**
 * Build a minimal MapLibre style containing only the given satellite raster source.
 * Project data layers are re-added on top after the style loads.
 */
function buildSatelliteSourceSpec(layerType: SatelliteLayerType): RasterSourceSpecification {
  const config = satelliteLayerConfigs[layerType];
  // Esri's usable max zoom varies by location and is refined at runtime; all other
  // layers use their fixed configured maxZoom.
  const maxzoom = layerType === "esri" ? currentEsriMaxZoom : config.maxZoom;
  return {
    type: "raster",
    tiles: config.tiles,
    tileSize: config.tileSize,
    attribution: config.attribution,
    maxzoom,
  };
}

function buildSatelliteStyle(layerType: SatelliteLayerType): StyleSpecification {
  return {
    version: 8,
    // Renders the project-points-count text-field with the same server-side Noto Sans Bold
    // as the plan style; without it MapLibre falls back to locally drawn TinySDF glyphs.
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      satellite: buildSatelliteSourceSpec(layerType),
    },
    layers: [{ id: "satellite", type: "raster", source: "satellite" }],
  };
}

/**
 * Switch the basemap style. Because project data now lives on the same map as the basemap,
 * setStyle() wipes the project source/layers, so they are re-added once the new style loads.
 */
let styleSwitchGeneration = 0;

async function switchToStyle(style: StyleSpecification | string): Promise<void> {
  const mlMap = getMap();
  const generation = (styleSwitchGeneration += 1);
  await new Promise<void>((resolve) => {
    void mlMap.once("style.load", () => {
      // A newer switch superseded this one: skip the work so it can't apply this call's
      // (now stale) style overrides or double-add project sources on the final style.
      if (generation !== styleSwitchGeneration) {
        resolve();
        return;
      }
      try {
        // Re-apply road/rail overrides if switching back to the plan style.
        if (style === OPENFREEMAP_STYLE_URL) {
          applyPlanStyleRoadOverrides(mlMap);
          applyRailStyleOverrides(mlMap);
          applyPoiVisibilityOverrides(mlMap);
          applySky(mlMap);
          applyMapLabelLanguage(mlMap);
          applyBuildings3DState(show3DBuildings.value);
        }
        addProjectDataToMlMap(mlMap);
        if (lastPendingProjectPointsGeojson) {
          updatePendingProjectPointsSource(lastPendingProjectPointsGeojson);
        }
        if (lastPendingProjectShapesGeojson) {
          updatePendingProjectShapesSource(lastPendingProjectShapesGeojson);
        }
        dropImageHandlesForStyleSwitch();
        // Re-add the selected overlay's edit-handle layer so it stays draggable.
        reattachEditHandlesAfterStyleSwitch();
        runViewportRenderLoop();
      } catch (error) {
        console.error("Failed to re-apply project layers after style switch:", error);
        toastError(error instanceof Error ? error.message : undefined, t("errors.mapInitFailed"));
      } finally {
        resolve();
      }
    });
    mlMap.setStyle(style);
  });
}

/**
 * Resolve the best satellite layer for the current view: a country-specific layer when
 * zoomed in over a supported country, otherwise the generic Esri layer.
 */
async function resolveSatelliteLayer(): Promise<SatelliteLayerType> {
  const mlMap = getMap();
  if (mlMap.getZoom() <= MAP_CONFIG.MIN_ZOOM_FOR_COUNTRY_LAYERS) {
    return "esri";
  }
  const center = mlMap.getCenter();
  const detectedCountry = await detectCountryFromCoordinates(center.lat, center.lng);
  return detectedCountry ?? "esri";
}

let tileLayerSwitchGeneration = 0;

/** Switch to a different tile layer. The most recent call wins. */
export async function switchTileLayer(layerType: TileLayerType): Promise<void> {
  const generation = ++tileLayerSwitchGeneration;

  // When switching to satellite, jump directly to the country-specific layer to avoid a
  // brief flash of the generic ESRI layer.
  const resolvedLayerType = layerType === "esri" ? await resolveSatelliteLayer() : layerType;

  if (generation !== tileLayerSwitchGeneration) {
    return;
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

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// Cache of max zoom by location (key: "lat,lng" rounded to ~100m).
const maxZoomCache = new Map<string, number>();

/** Check and adjust the Esri max native zoom for the current location. */
async function checkEsriMaxZoom() {
  if (currentTileLayer.value !== "esri") return;

  const mlMap = getMapOrNull();
  if (!mlMap) return;
  const center = mlMap.getCenter();
  const zoom = mlMap.getZoom();

  if (zoom < 15) return;

  // Cancel any pending fetch from a previous location before either serving the cache or
  // scheduling a new fetch, so a stale timer can't overwrite the value applied here.
  if (debounceTimer) clearTimeout(debounceTimer);

  const cacheKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
  const cachedMaxZoom = maxZoomCache.get(cacheKey);
  if (cachedMaxZoom !== undefined) {
    applyEsriMaxZoom(cachedMaxZoom);
    return;
  }

  debounceTimer = setTimeout(async () => {
    if (!getMapOrNull()) return;
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
  if (currentTileLayer.value !== "esri") return;
  if (currentEsriMaxZoom === zoomLevel) return;
  currentEsriMaxZoom = zoomLevel;

  const mlMap = getMapOrNull();
  if (!mlMap?.getSource("satellite")) return;

  // MapLibre has no public setter for a source's maxzoom, so rebuild the satellite
  // source/layer with the refined value. Re-add the layer beneath the first project
  // data layer so the basemap stays at the bottom of the stack.
  const bottomLayerId = mlMap.getStyle().layers.find((layer) => layer.id !== "satellite")?.id;
  if (mlMap.getLayer("satellite")) mlMap.removeLayer("satellite");
  mlMap.removeSource("satellite");
  mlMap.addSource("satellite", buildSatelliteSourceSpec("esri"));
  mlMap.addLayer({ id: "satellite", type: "raster", source: "satellite" }, bottomLayerId);
}

// Interface for the Esri Identify API response
interface EsriIdentifyResponse {
  results?: {
    attributes: {
      MaxMapLevel?: string;
      [key: string]: any;
    };
  }[];
}

/** Queries the ESRI Identify API to get the max native zoom level at the given location. */
async function fetchEsriMaxZoom(lat: number, lng: number): Promise<number> {
  const bounds = getMap().getBounds();
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

  const response = await fetch(url.toString());
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

/** Switch the satellite layer based on the map view location and zoom. */
async function checkAndAutoSwitchSatelliteLayer() {
  const layerBeforeResolve: TileLayerType = currentTileLayer.value;
  if (layerBeforeResolve === "plan") {
    return;
  }

  const targetLayer = await resolveSatelliteLayer();

  // The user may have switched to plan while the country was being resolved.
  const layerAfterResolve: TileLayerType = currentTileLayer.value;
  if (layerAfterResolve === "plan" || layerAfterResolve === targetLayer) {
    return;
  }

  await switchTileLayer(targetLayer);
}

/** Listen for map movements to maintain the satellite basemap (country switch + Esri max zoom). */
function initSatelliteMoveEndListener(mlMap: MaplibreMap) {
  mlMap.on("moveend", () => {
    void checkAndAutoSwitchSatelliteLayer();
    void checkEsriMaxZoom();
  });
}
