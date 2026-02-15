import L from "leaflet";
import { ref } from "vue";
import { map } from "@/services/core/map";
import { useAuthStore } from "@/stores/authStore";

// AI : Default max native zoom for Esri layer (safe baseline)
const BASELINE_ESRI_MAX_ZOOM = 18;

// AI : Available tile layer types
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
    flagUrl: "https://flagcdn.com/16x12/un.png", // UN flag for world map
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
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
    flagUrl: "https://flagcdn.com/16x12/un.png", // UN flag for world
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
    flagUrl: "https://flagcdn.com/16x12/fr.png",
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
    flagUrl: "https://flagcdn.com/16x12/ch.png",
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
  if (!map.value) {
    console.error("Map not initialized when trying to add tile layers");
    return;
  }

  // AI : Check if tile layers were lost during hot reload
  if (!activeTileLayer) {
    addTileLayersToMap();
  }

  initEsriMetadataListener(); // AI : Start listening for potential high-res availability
}

/**
 * AI : Initialize all tile layers without layer control (using custom control instead)
 */
function addTileLayersToMap(): void {
  if (!map.value) {
    return;
  }

  try {
    // AI : Create and add OSM layer as default (has built-in labels)
    activeTileLayer = createTileLayer("osm");
    activeTileLayer.addTo(map.value);
  } catch (error) {
    console.error("Failed to initialize tile layers:", error);
    // AI : Fallback to OSM layer on error
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

  // AI : Create standard tile layer
  return L.tileLayer(config.url, config.options);
}

// AI : Timer for fallback removal of old layers
let fallbackRemovalTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * AI : Switch to a different tile layer (for custom layer control)
 */
export async function switchTileLayer(layerType: TileLayerType) {
  if (!map.value || currentTileLayer.value === layerType) {
    return;
  }

  // AI : Clear any pending fallback removal from previous switches
  if (fallbackRemovalTimer) {
    clearTimeout(fallbackRemovalTimer);
    fallbackRemovalTimer = null;
  }

  // AI : Keep reference to old layer to remove it AFTER new one loads
  const oldLayer = activeTileLayer;

  try {
    // AI : Add new tile layer
    const newLayer = createTileLayer(layerType);
    newLayer.addTo(map.value);
    activeTileLayer = newLayer;

    // AI : Smooth transition: wait for new layer to load before removing old one
    const removeOldLayer = () => {
      if (oldLayer && map.value?.hasLayer(oldLayer)) {
        map.value.removeLayer(oldLayer);
      }
      // AI : Clear timer if it exists (load event happened before timeout)
      if (fallbackRemovalTimer) {
        clearTimeout(fallbackRemovalTimer);
        fallbackRemovalTimer = null;
      }
    };

    // AI : Remove on load or after timeout (fallback)
    newLayer.once("load", removeOldLayer);

    // AI : Safety fallback in case load event doesn't fire (e.g. cached or fast network)
    fallbackRemovalTimer = setTimeout(removeOldLayer, 2000);

    // AI : Update current layer reference
    currentTileLayer.value = layerType;

    // AI : Check max zoom immediately if switching to Esri
    if (layerType === "esri") {
      await checkEsriMaxZoom();
    }
  } catch (error) {
    console.error("Failed to switch tile layer:", error);
    // AI : Fallback to OSM on error
    if (layerType !== "osm") {
      // AI : If failed, try to add OSM immediately
      const fallbackLayer = createTileLayer("osm");
      fallbackLayer.addTo(map.value);
      activeTileLayer = fallbackLayer;
      currentTileLayer.value = "osm";

      // AI : Clean up old layer immediately in error case
      if (oldLayer && map.value.hasLayer(oldLayer)) {
        map.value.removeLayer(oldLayer);
      }
    }
  }
}

/**
 * AI : Get available tile layer options for UI
 */
export function getTileLayerOptions(): { label: string; value: TileLayerType; flagUrl: string }[] {
  const authStore = useAuthStore();
  const isAuthenticated = authStore.isAuthenticated;

  return Object.entries(tileLayerConfigs)
    .filter(([value]) => {
      // AI : Always allow OSM and Esri
      if (value === "osm" || value === "esri") return true;
      // AI : Only allow country specific layers if logged in
      return isAuthenticated;
    })
    .map(([value, config]) => ({
      label: config.label,
      value: value as TileLayerType,
      flagUrl: config.flagUrl,
    }));
}

export function isTileLayerType(value: string): value is TileLayerType {
  return ["FRA", "esri", "CHE", "osm"].includes(value);
}

/**
 * AI : Check if satellite layer needs to be switched based on new context (country)
 * AI : If in satellite mode, ensures we use the best layer for the country (or fallback to Esri)
 */
export async function checkAndSwitchSatelliteLayer(countryCode: string | undefined) {
  // AI : Do nothing if in Plan mode (OSM)
  if (currentTileLayer.value === "osm") return;

  const authStore = useAuthStore();

  // AI : Determine the target layer based on country support and auth
  const targetLayer: TileLayerType =
    countryCode && isTileLayerType(countryCode) && authStore.isAuthenticated
      ? (countryCode as TileLayerType)
      : "esri";

  // AI : Switch if needed
  if (currentTileLayer.value !== targetLayer) {
    await switchTileLayer(targetLayer);
  }
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
  if (currentTileLayer.value !== "esri" || !map.value) return;

  const center = map.value.getCenter();
  const zoom = map.value.getZoom();

  // AI : Only check if we are already quite zoomed in (optimization)
  if (zoom < 16) return;

  // AI : Round coordinates to cache key (approx 100m precision)
  const cacheKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
  const cachedMaxZoom = maxZoomCache.get(cacheKey);
  if (cachedMaxZoom !== undefined) {
    applyEsriMaxZoom(cachedMaxZoom);
    return;
  }

  // AI : Debounce the API call
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

    if (activeTileLayer && map.value) {
      (activeTileLayer.options as any).maxNativeZoom = zoomLevel;

      // AI : Force a redraw of the layer to fetch potential high-res tiles?
      // Only if we are currently at a zoom > oldMaxNativeZoom
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
  if (!map.value) return null;

  // AI : Construct Identity Query
  const bounds = map.value.getBounds();
  const extent = {
    xmin: bounds.getWest(),
    ymin: bounds.getSouth(),
    xmax: bounds.getEast(),
    ymax: bounds.getNorth(),
    spatialReference: { wkid: 4326 },
  };

  // AI : Esri World Imagery MapServer Identify Endpoint
  const url = new URL(
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify",
  );
  url.searchParams.append("f", "json");
  url.searchParams.append("geometry", `${lng},${lat}`);
  url.searchParams.append("geometryType", "esriGeometryPoint");
  url.searchParams.append("sr", "4326");
  url.searchParams.append("layers", "top"); // Query visible layers
  url.searchParams.append("tolerance", "2");
  url.searchParams.append(
    "mapExtent",
    `${extent.xmin},${extent.ymin},${extent.xmax},${extent.ymax}`,
  );
  url.searchParams.append("imageDisplay", "600,400,96");
  url.searchParams.append("returnGeometry", "false");

  const response = await fetch(url.toString());
  const data = (await response.json()) as EsriIdentifyResponse;

  if (data?.results && data.results.length > 0) {
    const attributes = data.results[0].attributes;

    // AI : Use explicit MaxMapLevel from metadata
    if (attributes.MaxMapLevel) {
      const maxLevel = Number.parseInt(attributes.MaxMapLevel, 10);
      if (!Number.isNaN(maxLevel)) {
        // AI : Respect explicit max level from metadata, even if lower than baseline
        // This fixes issues where metadata says 17 but we forced 18, leading to gray tiles
        // Cap at 22.
        return Math.min(maxLevel, 22);
      }
    }
  }

  // AI : Fallback if metadata missing or invalid
  return BASELINE_ESRI_MAX_ZOOM;
}

// AI : Hook up the listener init
function initEsriMetadataListener() {
  if (!map.value) return;
  map.value.on("moveend", checkEsriMaxZoom);
}

// AI : Accept HMR updates for this module
if (import.meta.hot) {
  import.meta.hot.accept();
}
