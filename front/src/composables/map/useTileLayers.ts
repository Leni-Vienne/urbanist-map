import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';

// AI : Available tile layer types
export type TileLayerType = 'france' | 'esri';

// AI : Current active tile layer
export const currentTileLayer = ref<TileLayerType>('esri');

// AI : Reference to the currently active tile layer instance
let activeTileLayer: L.TileLayer | null = null;

// AI : Tile layer configurations
const tileLayerConfigs = {
  france: {
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
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 18,
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      noWrap: true
    }
  }
};

/**
 * AI : Add the default tile layer to the map
 */
export function addTileLayer(): void {
  
  if (!map.value) {
    // AI : If map is not ready, wait for initialization
    onMapInitialized(() => {
      addTileLayerToMap();
    });
    return;
  }
  
  // AI : Check if tile layer was lost during hot reload
  if (!activeTileLayer) {
    addTileLayerToMap();
  }
}

/**
 * AI : Internal function to add tile layer to map
 */
function addTileLayerToMap(): void {
  if (!map.value) {
    return;
  }
  
  // AI : Remove existing tile layer if it exists (hot reload safety)
  if (activeTileLayer) {
    map.value.removeLayer(activeTileLayer);
  }
  
  const config = tileLayerConfigs[currentTileLayer.value];
  activeTileLayer = L.tileLayer(config.url, config.options);
  activeTileLayer.addTo(map.value);
}

/**
 * AI : Switch to a different tile layer
 */
export function switchTileLayer(layerType: TileLayerType): void {
  
  if (!map.value || currentTileLayer.value === layerType) {
    return;
  }
  
  // AI : Remove current tile layer
  if (activeTileLayer) {
    map.value.removeLayer(activeTileLayer);
  }
  
  // AI : Add new tile layer
  const config = tileLayerConfigs[layerType];
  activeTileLayer = L.tileLayer(config.url, config.options);
  activeTileLayer.addTo(map.value);
  
  // AI : Update current layer reference
  currentTileLayer.value = layerType;
}

/**
 * AI : Get available tile layer options for UI
 */
export function getTileLayerOptions() {
  return [
    { label: 'World (default)', value: 'esri' as TileLayerType },
    { label: 'France', value: 'france' as TileLayerType },
    
  ];
}
