import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';

// AI : Available tile layer types
export type TileLayerType = 'FRA' | 'esri' | 'CHE' | 'USA';

// AI : Current active tile layer
export const currentTileLayer = ref<TileLayerType>('esri');

// AI : Reference to the currently active tile layer instance
let activeTileLayer: L.TileLayer | L.GridLayer | null = null;

// To prevent requesting the tileLayer server for tiles outside the valid range
const tileLayerBounds = L.latLngBounds([-85, -180], [85, 180]);

// AI : Tile layer configurations with UI labels
const tileLayerConfigs = {
  esri: {
    label: 'World (default)',
    flagUrl: 'https://flagcdn.com/16x12/un.png', // UN flag for world
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 19,
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      noWrap: true,
      bounds: tileLayerBounds,
    },
  },
  FRA: {
    label: 'France',
    flagUrl: 'https://flagcdn.com/16x12/fr.png',
    url: 'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal',
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 19,
      tileSize: 256,
      attribution: "IGN-F/Géoportail",
      noWrap: true,
      bounds: tileLayerBounds
    }
  },
  USA: {
    label: 'USA',
    flagUrl: 'https://flagcdn.com/16x12/us.png',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 21,
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      noWrap: true,
      bounds: tileLayerBounds
    }
  },
  CHE: {
    label: 'Switzerland',
    flagUrl: 'https://flagcdn.com/16x12/ch.png',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    options: {
      minZoom: 2,
      maxZoom: 22,
      maxNativeZoom: 20,
      tileSize: 256,
      attribution: "© swisstopo",
      noWrap: true,
      bounds: tileLayerBounds
    }
  },
};

/**
 * AI : Add tile layers and layer control to the map
 */
export function addTileLayer(): void {
  if (!map.value) {
    // AI : If map is not ready, wait for initialization
    onMapInitialized(() => {
      addTileLayersToMap();
    });
    return;
  }

  // AI : Check if tile layers were lost during hot reload
  if (!activeTileLayer) {
    addTileLayersToMap();
  }
}

/**
 * AI : Initialize all tile layers without layer control (using custom control instead)
 */
function addTileLayersToMap(): void {
  if (!map.value) {
    return;
  }

  try {
    // AI : Create and add only the default ESRI layer
    activeTileLayer = createTileLayer('esri');
    activeTileLayer.addTo(map.value);
  } catch (error) {
    console.error('Failed to initialize tile layers:', error);
    // AI : Fallback to simple ESRI layer on error
    const fallbackLayer = createTileLayer('esri');
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


/**
 * AI : Switch to a different tile layer (for custom layer control)
 */
export function switchTileLayer(layerType: TileLayerType) {
  if (!map.value || currentTileLayer.value === layerType) {
    return;
  }

  // AI : Remove current tile layer
  if (activeTileLayer) {
    map.value.removeLayer(activeTileLayer);
  }

  try {
    // AI : Add new tile layer
    activeTileLayer = createTileLayer(layerType);
    activeTileLayer.addTo(map.value);

    // AI : Update current layer reference
    currentTileLayer.value = layerType;

  } catch (error) {
    console.error('Failed to switch tile layer:', error);
    // AI : Fallback to previous layer or default ESRI on error
    if (layerType !== 'esri') {
      activeTileLayer = createTileLayer('esri');
      activeTileLayer.addTo(map.value);
      currentTileLayer.value = 'esri';
    }
  }
}

/**
 * AI : Get available tile layer options for UI
 */
export function getTileLayerOptions(): { label: string; value: TileLayerType; flagUrl: string }[] {
  return Object.entries(tileLayerConfigs)
    .filter(([value]) => isTileLayerType(value))
    .map(([value, config]) => ({
      label: config.label,
      value: value as TileLayerType,
      flagUrl: config.flagUrl
    }));
}

export function isTileLayerType(value: string): value is TileLayerType {
  return ['FRA', 'esri', 'USA', 'CHE'].includes(value);
}
