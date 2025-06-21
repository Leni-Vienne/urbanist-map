import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';

// AI : Available tile layer types
export type TileLayerType = 'france' | 'esri';

// AI : Current active tile layer
export const currentTileLayer = ref<TileLayerType>('france');

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
  console.log('AI : addTileLayer called, map.value:', !!map.value);
  
  if (!map.value) {
    // AI : If map is not ready, wait for initialization
    console.log('AI : Map not ready, waiting for initialization');
    onMapInitialized(() => {
      console.log('AI : Map initialized, adding tile layer');
      addTileLayerToMap();
    });
    return;
  }
  
  addTileLayerToMap();
}

/**
 * AI : Internal function to add tile layer to map
 */
function addTileLayerToMap(): void {
  if (!map.value) {
    console.log('AI : Map still not available in addTileLayerToMap');
    return;
  }
  
  console.log('AI : Adding tile layer:', currentTileLayer.value);
  const config = tileLayerConfigs[currentTileLayer.value];
  activeTileLayer = L.tileLayer(config.url, config.options);
  activeTileLayer.addTo(map.value);
  console.log('AI : Tile layer added successfully');
}

/**
 * AI : Switch to a different tile layer
 */
export function switchTileLayer(layerType: TileLayerType): void {
  console.log('AI : switchTileLayer called:', layerType, 'current:', currentTileLayer.value, 'map:', !!map.value);
  
  if (!map.value || currentTileLayer.value === layerType) {
    console.log('AI : Switch cancelled - map not ready or same layer');
    return;
  }
  
  // AI : Remove current tile layer
  if (activeTileLayer) {
    console.log('AI : Removing current tile layer');
    map.value.removeLayer(activeTileLayer);
  }
  
  // AI : Add new tile layer
  console.log('AI : Adding new tile layer:', layerType);
  const config = tileLayerConfigs[layerType];
  activeTileLayer = L.tileLayer(config.url, config.options);
  activeTileLayer.addTo(map.value);
  
  // AI : Update current layer reference
  currentTileLayer.value = layerType;
  console.log('AI : Tile layer switched successfully');
}

/**
 * AI : Get available tile layer options for UI
 */
export function getTileLayerOptions() {
  return [
    { label: 'France (IGN)', value: 'france' as TileLayerType },
    { label: 'ESRI Satellite', value: 'esri' as TileLayerType }
  ];
}
