import L from "leaflet";
import { ref } from 'vue';
import { map, onMapInitialized } from '@composables/core/useMap';

// AI : Available tile layer types
export type TileLayerType = 'france' | 'esri' | 'google_satellite' | 'swiss';

// AI : Current active tile layer
export const currentTileLayer = ref<TileLayerType>('esri');

// AI : Reference to the currently active tile layer instance
let activeTileLayer: L.TileLayer | L.GridLayer | null = null;

// AI : Reference to the layer control instance
let layerControl: L.Control.Layers | null = null;

// AI : Store all tile layer instances for the layer control
const tileLayers: Record<string, L.TileLayer | L.GridLayer> = {};


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
      maxZoom: 22,
      maxNativeZoom: 21,
      type: 'satellite',
      attribution: "Google"
    }
  },
  swiss: {
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
async function addTileLayersToMap(): Promise<void> {
  if (!map.value) {
    return;
  }

  try {
    // AI : Create and add the default ESRI layer
    activeTileLayer = await createTileLayer('esri');
    activeTileLayer.addTo(map.value);

    // AI : Pre-create other layers for faster switching (optional)
    const franceLayer = await createTileLayer('france');
    const googleLayer = await createTileLayer('google_satellite');
    const swissLayer = await createTileLayer('swiss');

    // AI : Store layers in the tileLayers object for potential future use
    tileLayers['World (ESRI)'] = activeTileLayer;
    tileLayers['France (IGN)'] = franceLayer;
    tileLayers['Google Satellite'] = googleLayer;
    tileLayers['Switzerland (swisstopo)'] = swissLayer;

  } catch (error) {
    console.error('Failed to initialize tile layers:', error);
    // AI : Fallback to simple ESRI layer on error
    const fallbackLayer = await createTileLayer('esri');
    activeTileLayer = fallbackLayer;
    activeTileLayer.addTo(map.value);
  }
}


/**
 * AI : Create a tile layer based on configuration
 */
async function createTileLayer(layerType: TileLayerType): Promise<L.TileLayer | L.GridLayer> {
  const config = tileLayerConfigs[layerType];

  if ('type' in config && config.type === 'google') {
    // AI : Check if Google Maps API key is available
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.warn('AI : Google Maps API key not found, falling back to ESRI');
      // AI : Fallback to ESRI if no Google API key
      return createTileLayer('esri');
    }

    try {
      // AI : Dynamically import Google Mutant plugin to avoid bundling issues
      // @ts-ignore - No type definitions available for this plugin
      await import('leaflet.gridlayer.googlemutant');
      
      // AI : Load Google Maps API if not already loaded
      await loadGoogleMapsAPI(apiKey);
      
      return (L as any).gridLayer.googleMutant(config.options);
    } catch (error) {
      console.warn('AI : Failed to load Google Maps, falling back to ESRI:', error);
      return createTileLayer('esri');
    }
  } else {
    // AI : Create standard tile layer
    const standardConfig = config as { url: string; options: any };
    return L.tileLayer(standardConfig.url, standardConfig.options);
  }
}

/**
 * AI : Load Google Maps API
 */
function loadGoogleMapsAPI(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // AI : Check if already loaded
    if ((window as any).google?.maps) {
      resolve();
      return;
    }

    // AI : Create script element to load Google Maps API with async loading
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps API'));
    document.head.appendChild(script);
  });
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

    // AI : Update layer control if it exists
    if (layerControl) {
      // AI : Remove and recreate layer control with updated active layer
      map.value.removeControl(layerControl);
      
      // AI : Update the tileLayers object with the new active layer
      Object.keys(tileLayers).forEach(key => {
        if (map.value?.hasLayer(tileLayers[key])) {
          map.value.removeLayer(tileLayers[key]);
        }
      });
      
      // AI : Add the new active layer
      activeTileLayer.addTo(map.value);
    }
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
 * AI : Get available tile layer options for UI compatibility (deprecated with layer control)
 */
export function getTileLayerOptions() {
  return [
    { label: 'World (default)', value: 'esri' as TileLayerType },
    { label: 'France', value: 'france' as TileLayerType },
    { label: 'Google Satellite', value: 'google_satellite' as TileLayerType },
    { label: 'Switzerland', value: 'swiss' as TileLayerType },
  ];
}
