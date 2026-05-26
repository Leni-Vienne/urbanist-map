import { ref, watch } from "vue";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { GeoJSONSource, Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import { map, OPENFREEMAP_STYLE_URL } from "@/services/core/map";
import { MAP_CONFIG } from "@/constants/mapConstants";
import countryBboxes from "@/assets/country_bboxes.json";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import {
  addProjectDataToMlMap,
  registerHybridInteractionHandlers,
  applyTagFiltersToVectorLayers,
} from "./projectVectorLayers";
import { applyPlanStyleRoadOverrides, applyRailStyleOverrides } from "./basemapStyleOverrides";
import {
  selectedProjectTags,
  visibleStates,
  sizeFilterRange,
  selectedNameFilters,
  lastModifiedDateRange,
} from "@/services/overlay/statusFilters";

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

// True once the basemap style has loaded and project data + interaction are wired up.
// Preserved across Vite HMR so onMlMapReady callers don't wait for a `load` event that
// already fired on the still-alive map instance.
let styleReady = (import.meta.hot?.data.styleReady as boolean | undefined) ?? false;
let interactionRegistered =
  (import.meta.hot?.data.interactionRegistered as boolean | undefined) ?? false;
const mlMapReadyCallbacks: (() => void)[] = [];

/** The single MapLibre map, or null until its style has loaded. */
export function getMlMap(): MaplibreMap | null {
  return styleReady ? map.value : null;
}

/** Register a callback to run once (immediately if already ready) when the map is loaded. */
export function onMlMapReady(cb: () => void): void {
  if (styleReady) {
    cb();
  } else {
    mlMapReadyCallbacks.push(cb);
  }
}

// Cached after first load, undefined until the user first uses satellite mode
let countryBorders: CountryBorder[] | undefined = undefined;

let lastPendingProjectPointsGeojson: GeoJSON.FeatureCollection | null = null;

// Dynamically imports all country borders as a single chunk, only loads on first satellite use
async function ensureCountryBordersLoaded(): Promise<CountryBorder[]> {
  if (countryBorders) return countryBorders;

  const { borders: allBorders } = await import("@/assets/country-borders");

  const countryCodes = (Object.keys(satelliteLayerConfigs) as SatelliteLayerType[]).filter(
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
  } else {
    mlMap.once("load", cb);
  }
}

/** Initialize the map's project data layers and interaction once the basemap style is ready. */
export function addTileLayer(): void {
  const mlMap = map.value;
  if (!mlMap) return;

  // A dummy image prevents "styleimagemissing" errors for missing cluster icons.
  // Registered once; the handler persists across setStyle() satellite switches.
  mlMap.on("styleimagemissing", (e: { id: string }) => {
    mlMap.addImage(e.id, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
  });

  whenStyleLoaded(mlMap, () => {
    onFirstStyleReady(mlMap);
  });

  initEsriMetadataListener(); // Start listening for potential high-res availability
  initAutoCountrySwitchListener(); // Start listening for country-based satellite switching
}

/** Wire up project data + interaction on first style load, then mark the map ready. */
function onFirstStyleReady(mlMap: MaplibreMap): void {
  try {
    applyPlanStyleRoadOverrides(mlMap);
    applyRailStyleOverrides(mlMap);
    addProjectDataToMlMap(mlMap);

    if (!interactionRegistered) {
      registerHybridInteractionHandlers(() => map.value);
      interactionRegistered = true;
    }

    if (import.meta.env.DEV) {
      void import("@/services/map/debugClusterGrid").then(({ toggleClusterGrid }) => {
        (globalThis as any).toggleClusterGrid = () => toggleClusterGrid(mlMap);
      });
    }

    styleReady = true;
    for (const cb of mlMapReadyCallbacks) cb();
    mlMapReadyCallbacks.length = 0;

    if (lastPendingProjectPointsGeojson) {
      updatePendingProjectPointsSource(lastPendingProjectPointsGeojson);
    }
  } catch (error) {
    console.error("Failed to initialize MapLibre project layers:", error);
    useToast().add({
      severity: "error",
      summary: t("errors.mapInitFailed"),
      detail: error instanceof Error ? error.message : undefined,
      life: 8000,
    });
  }
}

// Watch for tag and status filter changes and update MVT layers on the map
watch(
  [selectedProjectTags, visibleStates, sizeFilterRange, selectedNameFilters, lastModifiedDateRange],
  () => {
    const mlMap = getMlMap();
    if (mlMap) {
      applyTagFiltersToVectorLayers(mlMap);
    }
  },
  { deep: true },
);

/** Update the pending-project-points source with fresh GeoJSON data (edit/moderation mode). */
export function updatePendingProjectPointsSource(geojson: GeoJSON.FeatureCollection): void {
  lastPendingProjectPointsGeojson = geojson;

  const mlMap = getMlMap();
  if (!mlMap) return;

  const source = mlMap.getSource("pending-project-points-source") as GeoJSONSource | undefined;
  if (source) {
    source.setData(geojson);
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
 * Switch the basemap style. Because project data now lives on the same map as the basemap,
 * setStyle() wipes the project source/layers, so they are re-added once the new style loads.
 */
async function switchToStyle(style: StyleSpecification | string): Promise<void> {
  const mlMap = getMlMap();
  if (!mlMap) return;

  await new Promise<void>((resolve) => {
    void mlMap.once("style.load", () => {
      // Re-apply road/rail overrides if switching back to the plan style.
      if (style === OPENFREEMAP_STYLE_URL) {
        applyPlanStyleRoadOverrides(mlMap);
        applyRailStyleOverrides(mlMap);
      }
      addProjectDataToMlMap(mlMap);
      if (lastPendingProjectPointsGeojson) {
        updatePendingProjectPointsSource(lastPendingProjectPointsGeojson);
      }
      resolve();
    });
    mlMap.setStyle(style);
  });
}

/** Switch to a different tile layer. */
export async function switchTileLayer(layerType: TileLayerType): Promise<void> {
  // When switching to satellite, try to jump directly to the country-specific layer
  // to avoid a brief flash of the generic ESRI layer.
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

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// Cache of max zoom by location (key: "lat,lng" rounded to ~100m).
const maxZoomCache = new Map<string, number>();

/** Check and adjust the Esri max native zoom for the current location. */
async function checkEsriMaxZoom() {
  if (currentTileLayer.value !== "esri") return;

  const center = map.value.getCenter();
  const zoom = map.value.getZoom();

  if (zoom < 15) return;

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
        // MapLibre GL JS doesn't officially support hot-swapping source maxzoom;
        // update it via internal properties and force a tile refresh.
        const source = mlMap.getSource("satellite");
        if (source) {
          (source as any).maxzoom = zoomLevel;
          try {
            const sourceCache = (mlMap.style as any).sourceCaches.satellite;
            if (sourceCache) {
              sourceCache.clearTiles();
              sourceCache.update((mlMap as any).transform);
            }
          } catch {
            // ignore
          }
          mlMap.triggerRepaint();
        }
      }
    }
  }
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

/** Switch the satellite layer based on the map view location and zoom. */
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

/** Start listening for map movements to auto-switch between country satellite layers. */
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
  import.meta.hot.dispose((data) => {
    data.styleReady = styleReady;
    data.interactionRegistered = interactionRegistered;
  });
  import.meta.hot.accept();
}
