import L from "leaflet";
import { ref } from "vue";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { map } from "@/services/core/map";
import { MAP_CONFIG } from "@/constants/mapConstants";
import countryBboxes from "@/assets/country_bboxes.json";

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

// Cached after first load — undefined until the user first uses satellite mode
let countryBorders: CountryBorder[] | undefined;

// Dynamically imports all country borders as a single chunk — only loads on first satellite use
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
 * @returns Country code (FRA, CHE) or undefined if not in any known country
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

// Default max native zoom for Esri layer (safe baseline)
const BASELINE_ESRI_MAX_ZOOM = 18;

// Available tile layer types (FRA and CHE are used internally via auto-detection)
export type TileLayerType = "FRA" | "esri" | "CHE" | "osm";

// Current active tile layer (OSM as default for built-in labels)
export const currentTileLayer = ref<TileLayerType>("osm");

// Vector tiles toggle — persisted in localStorage
const VECTOR_TILES_KEY = "useVectorTiles";

function getInitialVectorTiles(): boolean {
  try {
    return localStorage.getItem(VECTOR_TILES_KEY) === "true";
  } catch {
    return false;
  }
}

export const useVectorTiles = ref<boolean>(getInitialVectorTiles());
export function setVectorTiles(enabled: boolean) {
  useVectorTiles.value = enabled;
  try {
    localStorage.setItem(VECTOR_TILES_KEY, String(enabled));
  } catch {
    // Storage unavailable (privacy mode, quota exceeded) — preference not persisted
  }
}

// Reference to the currently active tile layer instance
let activeTileLayer: L.TileLayer | L.GridLayer | null = null;

// Tile layer configurations with UI labels
const tileLayerConfigs = {
  osm: {
    label: "Plan",
    url:
      import.meta.env.VITE_DEBUG === "true"
        ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        : `https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.webp?key=${import.meta.env.VITE_MAPTILER_API_KEY}`,
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 19,
      tileSize: 256,
      //attribution: "© OpenStreetMap contributors",
      attribution:
        '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
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
    },
  },
};

/**
 * Add tile layers and layer control to the map
 */

export function addTileLayer(): void {
  // Check if tile layers were lost during hot reload
  if (!activeTileLayer) {
    void addTileLayersToMap();
  }

  initEsriMetadataListener(); // Start listening for potential high-res availability
  initAutoCountrySwitchListener(); // Start listening for country-based satellite switching
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Skip if already injected (e.g. called twice before first load completes isn't guarded here,
    // but ensureMaplibreLoaded checks globalThis.maplibregl so this is a safety net)
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    // crossorigin="anonymous" enables proper error reporting for cross-origin scripts
    // and is required for SRI integrity checks. Integrity hashes should be added here
    // (sha384-<hash>) once computed for each pinned version, or the assets should be
    // bundled via Vite to eliminate the CDN dependency entirely.
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", reject);
    document.head.appendChild(script);
  });
}

function loadStylesheet(href: string): void {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

async function ensureMaplibreLoaded(): Promise<void> {
  if ((globalThis as any).maplibregl) return;
  // CSS can load in parallel with JS — no dependency
  loadStylesheet("https://unpkg.com/maplibre-gl@5.20.0/dist/maplibre-gl.css");
  // leaflet-maplibre-gl depends on maplibregl being defined, so load sequentially
  await loadScript("https://unpkg.com/maplibre-gl@5.20.0/dist/maplibre-gl.js");
  await loadScript("https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.3/leaflet-maplibre-gl.js");
}

/**
 * Initialize all tile layers without layer control (using custom control instead)
 */
async function addTileLayersToMap(): Promise<void> {
  try {
    if (useVectorTiles.value) {
      await ensureMaplibreLoaded();
      activeTileLayer = (L as any)
        .maplibreGL({
          style: "https://tiles.openfreemap.org/styles/liberty",
        })
        .addTo(map.value);
    } else {
      activeTileLayer = createTileLayer("osm");
      activeTileLayer.addTo(map.value);
    }
  } catch (error) {
    console.error("Failed to initialize tile layers:", error);
    const fallbackLayer = createTileLayer("osm");
    activeTileLayer = fallbackLayer;
    activeTileLayer.addTo(map.value);
  }
}

/**
 * Create a tile layer based on configuration
 */
function createTileLayer(layerType: TileLayerType): L.TileLayer | L.GridLayer {
  const config = tileLayerConfigs[layerType];
  return L.tileLayer(config.url, config.options);
}

// Timer for fallback removal of old layers
let fallbackRemovalTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Switch to a different tile layer (for custom layer control)
 */
export async function switchTileLayer(layerType: TileLayerType) {
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

  if (fallbackRemovalTimer) {
    clearTimeout(fallbackRemovalTimer);
    fallbackRemovalTimer = null;
  }

  const newLayer = createTileLayer(resolvedLayerType);
  newLayer.addTo(map.value);

  activeTileLayer = newLayer;
  currentTileLayer.value = resolvedLayerType;

  // Robust Cleanup Strategy (Last Write Wins)
  // Iterate through all layers and remove any TileLayer that is NOT the active one.
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

  if (resolvedLayerType === "esri") {
    await checkEsriMaxZoom();
  }
}

export function isTileLayerType(value: string): value is TileLayerType {
  return ["FRA", "esri", "CHE", "osm"].includes(value);
}

// Debounce timer for metadata queries
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Cache for max zoom at locations to prevent repeated queries
// Key: "lat,lng" rounded to ~100m, Value: maxZoom
const maxZoomCache = new Map<string, number>();

/**
 * Query Esri Metadata to look for high-resolution imagery availability
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
      console.warn("Failed to fetch Esri metadata", error);
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

  return BASELINE_ESRI_MAX_ZOOM;
}

// Hook up the listener init
function initEsriMetadataListener() {
  map.value.on("moveend", () => {
    void checkEsriMaxZoom();
  });
}

/**
 * Automatically switch satellite layer based on map view location and zoom
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
 * Initialize listener for automatic country-based satellite switching
 */
function initAutoCountrySwitchListener() {
  map.value.on("moveend", () => {
    void checkAndAutoSwitchSatelliteLayer();
  });
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
