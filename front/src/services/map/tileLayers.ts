import { ref, watch } from "vue";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { GeoJSONSource, Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { maplibreLayer, type MaplibreGL } from "@/lib/MaplibreLayer";
import { map } from "@/services/core/map";
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

const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/copyright" target="_blank" rel="noopener">&copy; OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>';

let currentAttribution = "";

function updateLeafletAttribution(newAttribution: string) {
  if (!map.value?.attributionControl) return;

  if (currentAttribution) {
    map.value.attributionControl.removeAttribution(currentAttribution);
  }

  if (newAttribution) {
    map.value.attributionControl.addAttribution(newAttribution);
  }

  currentAttribution = newAttribution;
}

// Current active tile layer ("plan" = MapLibre vector basemap)
export const currentTileLayer = ref<TileLayerType>("plan");

/** Reference to the basemap MapLibre map instance (renders below overlays at z-200). */
// During Vite HMR, the module re-executes but the MapLibre instance is still alive on the page.
// Preserved via import.meta.hot.data so onMlMapReady callers don't get stuck waiting
// for a `load` event that will never fire again.
const mlMapRef = {
  current: (import.meta.hot?.data.mlMap as MaplibreMap | null) ?? null,
};
const mlMapReadyCallbacks: (() => void)[] = [];

/** Reference to the vector overlay MapLibre map instance (renders above overlays at z-450). */
// This map contains project shapes, overlay footprints, and all project-related vector data.
const vectorMapRef = {
  current: (import.meta.hot?.data.vectorMap as MaplibreMap | null) ?? null,
};

// Export the vector map as the primary mlMap reference since that's where project data lives
export function getMlMap(): MaplibreMap | null {
  return vectorMapRef.current;
}

function getBasemapMlMap(): MaplibreMap | null {
  return mlMapRef.current;
}

/** Register a callback to be called once (and immediately if already ready) when vector mlMap is loaded. */
export function onMlMapReady(cb: () => void): void {
  if (vectorMapRef.current) {
    cb();
  } else {
    mlMapReadyCallbacks.push(cb);
  }
}

/** Reference to the currently active MapLibre-GL Leaflet layer. Never removed from the map. */
let activeBaseLayer: MaplibreGL | null = null;

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

/** Initialize tile layers. */
export function addTileLayer(): void {
  // Check if tile layers were lost during hot reload
  if (!activeBaseLayer) {
    void addTileLayersToMap();
  }

  if (currentTileLayer.value === "plan") {
    updateLeafletAttribution(OPENFREEMAP_ATTRIBUTION);
  } else {
    updateLeafletAttribution(satelliteLayerConfigs[currentTileLayer.value].attribution);
  }

  initEsriMetadataListener(); // Start listening for potential high-res availability
  initAutoCountrySwitchListener(); // Start listening for country-based satellite switching
}

/**
 * Initialize the two MapLibre-GL Leaflet layers:
 * - Basemap layer at tilePane (z-200): full OpenFreeMap style
 * - Vector overlay layer at vectorPane (z-450): transparent, project geometries only
 * The layers are permanent; satellite mode swaps the basemap style via setStyle().
 */
async function addTileLayersToMap(): Promise<void> {
  try {
    // Two MapLibre layers keep project geometry on top of distortable overlay images.
    const vectorPane = map.value.createPane("vectorPane");
    vectorPane.style.zIndex = "450";
    // Prevent the vector canvas from capturing pointer events so overlays at z-400 remain
    // interactive. Leaflet forwards map-level events to MapLibre via queryRenderedFeatures.
    vectorPane.style.pointerEvents = "none";

    // Basemap: padding 0.1 pre-fetches tiles just outside the viewport to avoid edge flicker.
    const basemapLayer = maplibreLayer({
      style: OPENFREEMAP_STYLE_URL,
      fadeDuration: 0,
      padding: 0.1,
      pane: "tilePane", // Default pane at z-200
    }).addTo(map.value);
    activeBaseLayer = basemapLayer;

    const mlMap = basemapLayer.getMaplibreMap();

    // Add a dummy image to prevent "styleimagemissing" errors for missing cluster icons.
    mlMap.on("styleimagemissing", (e: { id: string }) => {
      mlMap.addImage(e.id, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
    });

    mlMap.on("load", () => {
      mlMapRef.current = mlMap;

      applyPlanStyleRoadOverrides(mlMap);
      applyRailStyleOverrides(mlMap);

      // Project data is added to the vector overlay layer, not here.

      if (lastPendingProjectPointsGeojson) {
        updatePendingProjectPointsSource(lastPendingProjectPointsGeojson);
      }
    });

    // Vector overlay layer: transparent background, only project layers.
    const vectorLayer = maplibreLayer({
      style: {
        version: 8,
        sources: {},
        layers: [],
      },
      fadeDuration: 0,
      pane: "vectorPane", // Custom pane at z-450
    }).addTo(map.value);

    const vectorMap = vectorLayer.getMaplibreMap();

    vectorMap.on("styleimagemissing", (e: { id: string }) => {
      vectorMap.addImage(e.id, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
    });

    vectorMap.on("load", () => {
      vectorMapRef.current = vectorMap;

      addProjectDataToMlMap(vectorMap);
      registerHybridInteractionHandlers(() => vectorMap);

      if (import.meta.env.DEV) {
        void import("@/services/map/debugClusterGrid").then(({ toggleClusterGrid }) => {
          (globalThis as any).toggleClusterGrid = () => toggleClusterGrid(vectorMap);
        });
      }

      for (const cb of mlMapReadyCallbacks) cb();
      mlMapReadyCallbacks.length = 0;
    });
  } catch (error) {
    console.error("Failed to initialize MapLibre tile layer:", error);
    useToast().add({
      severity: "error",
      summary: t("errors.mapInitFailed"),
      detail: error instanceof Error ? error.message : undefined,
      life: 8000,
    });
  }
}

// Watch for tag and status filter changes and update MVT layers on the vector overlay map
watch(
  [selectedProjectTags, visibleStates, sizeFilterRange, selectedNameFilters, lastModifiedDateRange],
  () => {
    const vectorMap = vectorMapRef.current;
    if (vectorMap) {
      applyTagFiltersToVectorLayers(vectorMap);
    }
  },
  { deep: true },
);

/** Update the pending-project-points source with fresh GeoJSON data (edit/moderation mode). */
export function updatePendingProjectPointsSource(geojson: GeoJSON.FeatureCollection): void {
  lastPendingProjectPointsGeojson = geojson;

  const vectorMap = vectorMapRef.current;
  if (!vectorMap) return;

  const source = vectorMap.getSource("pending-project-points-source") as GeoJSONSource | undefined;
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
 * Switch the basemap to a new style.
 * Project data stays on the separate vector overlay map and is not affected.
 */
async function switchToStyle(style: StyleSpecification | string): Promise<void> {
  const mlMap = mlMapRef.current;
  if (!mlMap) return;

  await new Promise<void>((resolve) => {
    void mlMap.once("style.load", () => {
      // Re-apply road/rail overrides if switching back to the plan style.
      if (style === OPENFREEMAP_STYLE_URL) {
        applyPlanStyleRoadOverrides(mlMap);
        applyRailStyleOverrides(mlMap);
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
    updateLeafletAttribution(OPENFREEMAP_ATTRIBUTION);
  } else {
    await switchToStyle(buildSatelliteStyle(resolvedLayerType));
    updateLeafletAttribution(satelliteLayerConfigs[resolvedLayerType].attribution);
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
      const mlMap = getBasemapMlMap(); // Use basemap since satellite source is there
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
  // Save the live MapLibre instances before the module is discarded so the
  // replacement module can restore them and skip the stale `load` event wait.
  import.meta.hot.dispose((data) => {
    data.mlMap = mlMapRef.current;
    data.vectorMap = vectorMapRef.current;
  });
  import.meta.hot.accept();
}
