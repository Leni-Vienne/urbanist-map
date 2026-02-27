import L from "leaflet";
import { ref } from "vue";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { map } from "@/services/core/map";
import { MAP_CONFIG } from "@/constants/mapConstants";

// AI : country_bboxes is small (~500B) and used for fast pre-checks, keep it eager
import countryBboxes from "@/assets/country_bboxes.json";
// AI : FRA.json and CHE.json are large polygon files — loaded lazily on first satellite use

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

type CountryCode = "FRA" | "CHE";

// AI : Helper to convert bbox array to BoundingBox object
function toBoundingBox(bbox: number[]): BoundingBox {
  return {
    minLng: bbox[0]!,
    minLat: bbox[1]!,
    maxLng: bbox[2]!,
    maxLat: bbox[3]!,
  };
}

// AI : Cached after first load — undefined until the user first uses satellite mode
let countryBorders: CountryBorder[] | undefined;

// AI : Dynamically imports all country borders as a single chunk — only loads on first satellite use
async function ensureCountryBordersLoaded(): Promise<CountryBorder[]> {
  if (countryBorders) return countryBorders;

  const { FRA: fraGeoJson, CHE: cheGeoJson } = await import("@/assets/country-borders");

  countryBorders = [
    {
      code: "FRA",
      geojson: fraGeoJson as FeatureCollection<Polygon | MultiPolygon>,
      bbox: toBoundingBox(countryBboxes.FRA),
    },
    {
      code: "CHE",
      geojson: cheGeoJson as FeatureCollection<Polygon | MultiPolygon>,
      bbox: toBoundingBox(countryBboxes.CHE),
    },
  ];

  return countryBorders;
}

/**
 * AI : Fast check if point is within bounding box
 */
function isInBoundingBox(lat: number, lng: number, bbox: BoundingBox): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

/**
 * AI : Ray casting algorithm for point-in-polygon detection
 * @param lat Point latitude
 * @param lng Point longitude
 * @param ring Polygon ring as array of [lng, lat] coordinates
 */
function isPointInPolygon(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  const x = lng;
  const y = lat;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;

    const intersect = yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * AI : Check if a point is inside any of the country's polygons (ray-casting algorithm with hole support)
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
 * AI : Detect which country contains the given coordinates.
 * Async because the GeoJSON border data is lazy-loaded on first call.
 * @param lat Latitude
 * @param lng Longitude
 * @returns Country code (FRA, CHE) or undefined if not in any known country
 */
async function detectCountryFromCoordinates(
  lat: number,
  lng: number,
): Promise<CountryCode | undefined> {
  const borders = await ensureCountryBordersLoaded();

  for (const country of borders) {
    // AI : Fast bounding box pre-check (75x faster when outside)
    if (!isInBoundingBox(lat, lng, country.bbox)) {
      continue;
    }

    if (isPointInCountry(lat, lng, country.geojson)) {
      return country.code;
    }
  }
  return undefined;
}

// AI : Default max native zoom for Esri layer (safe baseline)
const BASELINE_ESRI_MAX_ZOOM = 18;

// AI : Available tile layer types (FRA and CHE are used internally via auto-detection)
export type TileLayerType = "FRA" | "esri" | "CHE" | "osm";

// AI : Current active tile layer (OSM as default for built-in labels)
export const currentTileLayer = ref<TileLayerType>("osm");

// AI : Reference to the currently active tile layer instance
let activeTileLayer: L.TileLayer | L.GridLayer | null = null;

// To prevent requesting the tileLayer server for tiles outside the valid range
const tileLayerBounds = L.latLngBounds([-85, -180], [85, 180]);

// AI : Tile layer configurations with UI labels
const tileLayerConfigs = {
  osm: {
    label: "Plan",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 19,
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      noWrap: true,
      subdomains: "abc",
      bounds: tileLayerBounds,
    },
  },
  esri: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: BASELINE_ESRI_MAX_ZOOM,
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics, GIS User Community",
      noWrap: true,
      bounds: tileLayerBounds,
    },
  },
  FRA: {
    label: "France",
    url: "https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal",
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 19,
      tileSize: 256,
      attribution: "IGN-F/Géoportail",
      noWrap: true,
      bounds: tileLayerBounds,
    },
  },
  CHE: {
    label: "Switzerland",
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage-product/default/2025/3857/{z}/{x}/{y}.png",
    options: {
      minZoom: 2,
      maxZoom: 22,
      maxNativeZoom: 20,
      tileSize: 256,
      attribution: "© swisstopo",
      noWrap: true,
      bounds: tileLayerBounds,
    },
  },
};

/**
 * AI : Add tile layers and layer control to the map
 */

export function addTileLayer(): void {
  // AI : Check if tile layers were lost during hot reload
  if (!activeTileLayer) {
    addTileLayersToMap();
  }

  initEsriMetadataListener(); // AI : Start listening for potential high-res availability
  initAutoCountrySwitchListener(); // AI : Start listening for country-based satellite switching
}

/**
 * AI : Initialize all tile layers without layer control (using custom control instead)
 */
function addTileLayersToMap(): void {
  try {
    // AI : Create and add OSM layer as default (has built-in labels)
    activeTileLayer = createTileLayer("osm");
    activeTileLayer.addTo(map.value);
  } catch (error) {
    console.error("Failed to initialize tile layers:", error);
    const fallbackLayer = createTileLayer("osm");
    activeTileLayer = fallbackLayer;
    activeTileLayer.addTo(map.value);
  }
}

/**
 * AI : Create a tile layer based on configuration
 */
function createTileLayer(layerType: TileLayerType): L.TileLayer | L.GridLayer {
  const config = tileLayerConfigs[layerType];
  return L.tileLayer(config.url, config.options);
}

// AI : Timer for fallback removal of old layers
let fallbackRemovalTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * AI : Switch to a different tile layer (for custom layer control)
 */
export async function switchTileLayer(layerType: TileLayerType) {
  // AI : Optimization: If switching to satellite, check if we should directly go to a country layer
  // AI : This prevents loading ESRI first then immediately switching (avoiding "flash" and wasted requests)
  if (layerType === "esri") {
    const currentZoom = map.value.getZoom();
    if (currentZoom > MAP_CONFIG.MIN_ZOOM_FOR_COUNTRY_LAYERS) {
      const center = map.value.getCenter();
      const detectedCountry = await detectCountryFromCoordinates(center.lat, center.lng);
      if (detectedCountry && isTileLayerType(detectedCountry)) {
        layerType = detectedCountry;
      }
    }
  }

  if (currentTileLayer.value === layerType) {
    return;
  }

  if (fallbackRemovalTimer) {
    clearTimeout(fallbackRemovalTimer);
    fallbackRemovalTimer = null;
  }

  const newLayer = createTileLayer(layerType);
  newLayer.addTo(map.value);

  activeTileLayer = newLayer;
  currentTileLayer.value = layerType;

  // AI : Robust Cleanup Strategy (Last Write Wins)
  // AI : Iterate through all layers and remove any TileLayer that is NOT the active one.
  function cleanupLayers() {
    map.value.eachLayer((layer) => {
      if (layer instanceof L.TileLayer && layer !== activeTileLayer) {
        map.value.removeLayer(layer);
      }
    });

    if (fallbackRemovalTimer) {
      clearTimeout(fallbackRemovalTimer);
      fallbackRemovalTimer = null;
    }
  }

  newLayer.once("load", cleanupLayers);
  fallbackRemovalTimer = setTimeout(cleanupLayers, 2000);

  if (layerType === "esri") {
    await checkEsriMaxZoom();
  }
}

export function isTileLayerType(value: string): value is TileLayerType {
  return ["FRA", "esri", "CHE", "osm"].includes(value);
}

// AI : Debounce timer for metadata queries
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// AI : Cache for max zoom at locations to prevent repeated queries
// Key: "lat,lng" rounded to ~100m, Value: maxZoom
const maxZoomCache = new Map<string, number>();

/**
 * AI : Query Esri Metadata to look for high-resolution imagery availability
 * and dynamically adjust the maxNativeZoom.
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
      console.warn("AI : Failed to fetch Esri metadata", error);
    }
  }, 500);
}

function applyEsriMaxZoom(zoomLevel: number) {
  const esriConfig = tileLayerConfigs.esri;

  if (esriConfig.options.maxNativeZoom !== zoomLevel) {
    esriConfig.options.maxNativeZoom = zoomLevel;

    if (activeTileLayer) {
      (activeTileLayer.options as any).maxNativeZoom = zoomLevel;

      if (map.value.getZoom() > BASELINE_ESRI_MAX_ZOOM) {
        activeTileLayer.redraw();
      }
    }
  }
}

// AI : Interface for Esri Identify Response
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

  return BASELINE_ESRI_MAX_ZOOM;
}

// AI : Hook up the listener init
function initEsriMetadataListener() {
  map.value.on("moveend", () => {
    void checkEsriMaxZoom();
  });
}

/**
 * AI : Automatically switch satellite layer based on map view location and zoom
 */
async function checkAndAutoSwitchSatelliteLayer() {
  if (currentTileLayer.value === "osm") {
    return;
  }

  const currentZoom = map.value.getZoom();

  if (currentZoom <= MAP_CONFIG.MIN_ZOOM_FOR_COUNTRY_LAYERS) {
    if (currentTileLayer.value !== "esri") {
      switchTileLayer("esri");
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
    switchTileLayer(targetLayer);
  }
}

/**
 * AI : Initialize listener for automatic country-based satellite switching
 */
function initAutoCountrySwitchListener() {
  map.value.on("moveend", () => {
    void checkAndAutoSwitchSatelliteLayer();
  });
}

// AI : Accept HMR updates for this module
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
