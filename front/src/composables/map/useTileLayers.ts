import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';
import 'leaflet.gridlayer.googlemutant';

// AI : Available tile layer types
export type TileLayerType = 'france' | 'esri' | 'google_satellite';

// AI : Current active tile layer
export const currentTileLayer = ref<TileLayerType>('esri');

// AI : Reference to the currently active tile layer instance
let activeTileLayer: L.TileLayer | L.GridLayer | null = null;

// AI : Track if Google Maps API is loaded
let googleMapsLoaded = false;
let googleMapsLoading = false;

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
  },
  google_satellite: {
    type: 'google',
    options: {
      type: 'satellite',
      attribution: "Google"
    }
  },
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
 * AI : Load Google Maps API dynamically
 */
function loadGoogleMapsAPI(): Promise<void> {
  return new Promise((resolve, reject) => {
    // AI : Check if already loaded
    if (googleMapsLoaded && (window as any).google?.maps) {
      resolve();
      return;
    }

    // AI : Check if already loading
    if (googleMapsLoading) {
      // AI : Wait for existing load to complete
      const checkLoaded = () => {
        if (googleMapsLoaded && (window as any).google?.maps) {
          resolve();
        } else {
          setTimeout(checkLoaded, 100);
        }
      };
      checkLoaded();
      return;
    }

    googleMapsLoading = true;

    // AI : Get Google Maps API key from environment
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      googleMapsLoading = false;
      reject(new Error('Google Maps API key not found. Please set VITE_GOOGLE_MAPS_API_KEY in your environment variables.'));
      return;
    }

    // AI : Create script element to load Google Maps API
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=3`; //
    script.async = true;
    script.defer = true;

    script.onload = () => {
      googleMapsLoaded = true;
      googleMapsLoading = false;
      resolve();
    };

    script.onerror = () => {
      googleMapsLoading = false;
      reject(new Error('Failed to load Google Maps API'));
    };

    document.head.appendChild(script);
  });
}

/**
 * AI : Create a tile layer based on configuration
 */
async function createTileLayer(layerType: TileLayerType): Promise<L.TileLayer | L.GridLayer> {
  const config = tileLayerConfigs[layerType];

  if ('type' in config && config.type === 'google') {
    // AI : Load Google Maps API first
    await loadGoogleMapsAPI();
    // AI : Create Google Mutant layer
    return (L as any).gridLayer.googleMutant(config.options);
  } else {
    // AI : Create standard tile layer
    const standardConfig = config as { url: string; options: any };
    return L.tileLayer(standardConfig.url, standardConfig.options);
  }
}

/**
 * AI : Internal function to add tile layer to map
 */
async function addTileLayerToMap(): Promise<void> {
  if (!map.value) {
    return;
  }

  // AI : Remove existing tile layer if it exists (hot reload safety)
  if (activeTileLayer) {
    map.value.removeLayer(activeTileLayer);
  }

  try {
    activeTileLayer = await createTileLayer(currentTileLayer.value);
    activeTileLayer.addTo(map.value);
  } catch (error) {
    console.error('Failed to create tile layer:', error);
    // AI : Fallback to default ESRI layer on error
    if (currentTileLayer.value !== 'esri') {
      currentTileLayer.value = 'esri';
      activeTileLayer = await createTileLayer('esri');
      activeTileLayer.addTo(map.value);
    }
  }
}

/**
 * AI : Switch to a different tile layer
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
    console.error('Failed to switch tile layer:', error);
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
  return [
    { label: 'World (default)', value: 'esri' as TileLayerType },
    { label: 'France', value: 'france' as TileLayerType },
    { label: 'Google Satellite', value: 'google_satellite' as TileLayerType },
  ];
}
