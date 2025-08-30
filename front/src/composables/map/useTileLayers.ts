import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';

// AI : Available tile layer types
export type TileLayerType = 'FRA' | 'esri' | 'CHE';

// AI : Current active tile layer
export const currentTileLayer = ref<TileLayerType>('esri');

// AI : Reference to the currently active tile layer instance
let activeTileLayer: L.TileLayer | L.GridLayer | null = null;

// AI : Tile layer configurations with UI labels
const tileLayerConfigs = {
  FRA: {
    label: 'France (IGN)',
    url: 'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal',
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 19,
      tileSize: 256,
      attribution: "IGN-F/Géoportail",
      noWrap: true
    }
  },
  esri: {
    label: 'World (default)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 19,
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      noWrap: true
    }
  },
  USA: {
    label: 'USA (ESRI)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 21,
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      noWrap: true
    }
  },
  CHE: {
    label: 'Switzerland (swisstopo)',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    options: {
      minZoom: 2,
      maxZoom: 22,
      maxNativeZoom: 20,
      tileSize: 256,
      attribution: "© swisstopo",
      noWrap: true
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
export async function switchTileLayer(layerType: TileLayerType): Promise<void> {
  if (!map.value || currentTileLayer.value === layerType) {
    return;
  }

  // AI : Remove current tile layer
  if (activeTileLayer) {
    map.value.removeLayer(activeTileLayer);
  }

  try {
    // AI : Add new tile layer
    activeTileLayer = await createTileLayer(layerType);
    activeTileLayer.addTo(map.value);

    // AI : Update current layer reference
    currentTileLayer.value = layerType;

  } catch (error) {
    console.error('AI : Failed to switch tile layer:', error);
    // AI : Fallback to previous layer or default ESRI on error
    if (layerType !== 'esri') {
      activeTileLayer = await createTileLayer('esri');
      activeTileLayer.addTo(map.value);
      currentTileLayer.value = 'esri';
    }
  }
}

/**
 * AI : Get available tile layer options for UI
 */
export function getTileLayerOptions() {
  return Object.entries(tileLayerConfigs).map(([value, config]) => ({
    label: config.label,
    value: value as TileLayerType
  }));
}
