import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated'; // using "-updated" to prevent "WebSocket connection to 'ws://localhost:8081/ws' failed:" error
import { ref, shallowRef } from 'vue';
import { getSavedMapPosition, saveMapPosition } from './useDatabase';
import type { MapPosition } from '../types';
import { debounce } from '../utils';

// shallowRef is used to avoid reactivity issues with Leaflet, see https://stackoverflow.com/a/73588115/12498040
export const map = shallowRef<L.Map | null>(null); 
export const mapSize = ref({ width: 0, height: 0 });
// AI : Flag to track if the map is fully initialized
export const mapInitialized = ref(false);

// AI : Event system for map initialization
type InitListener = () => void;
const initListeners: InitListener[] = [];

export function onMapInitialized(callback: InitListener): void {
  if (mapInitialized.value) {
    // AI : If already initialized, execute callback immediately
    callback();
  } else {
    // AI : Otherwise, add to listeners queue
    initListeners.push(callback);
  }
}

// AI : Create a debounced version of updateMapSize
export const debouncedUpdateMapSize = debounce(function() {
  if (!map.value) return;
  const container = map.value.getContainer();
  mapSize.value = {
    width: container.clientWidth,
    height: container.clientHeight
  };
  
  // AI : Trigger a resize event on the map to ensure all components adjust
  map.value.invalidateSize();
  
  // AI : Set initialized flag to true once we have valid dimensions
  if (mapSize.value.width > 0 && mapSize.value.height > 0 && !mapInitialized.value) {
    mapInitialized.value = true;
    
    // AI : Notify all listeners
    initListeners.forEach(callback => callback());
  }
}, 250);

export async function initializeMap() {
  const savedPosition = await getSavedMapPosition();

  // AI : Default coordinates for Paris if no saved position is found
  const defaultLat = 48.8566;
  const defaultLng = 2.3522;
  const defaultZoom = 13;

  // AI : Use saved position or defaults
  const center = savedPosition ? savedPosition.center : [defaultLat, defaultLng];
  const zoom = savedPosition ? savedPosition.zoom : defaultZoom;

  const initialView: L.LatLngExpression = { lat: center[0], lng: center[1] };

  map.value = L.map("viewerDiv", { maxZoom: 22 }).setView(initialView, zoom);
  if (!map.value) throw new Error('No map element found');

  // AI : Save map dimensions
  debouncedUpdateMapSize();
  
  // AI : Update map size when window is resized (debounced to trigger only on resize end)
  window.addEventListener('resize', debouncedUpdateMapSize);

  // AI : Save default position if none exists
  if (!savedPosition) {
    await saveCurrentMapPosition();
  }

  addTileLayer();
  map.value.on('moveend zoomend', saveCurrentMapPosition);

  // AI : Ensure the map initialization is complete by forcing a size update
  // AI : This helps with the coverage calculation on initial load
  setTimeout(() => {
    if (map.value) {
      map.value.invalidateSize();
      debouncedUpdateMapSize();
    }
  }, 100);
}

// AI : Calculate how much of the screen an overlay covers (as a percentage)
export function calculateScreenCoverage(bounds: L.LatLngBounds): number {
  if (!map.value || !bounds?.isValid?.() || !mapInitialized.value) {
    if (bounds && !bounds.isValid()) {
      console.warn('Invalid bounds object passed to calculateScreenCoverage');
    }
    // AI : Return a default value higher than thumbnail threshold when map is not initialized
    // AI : This ensures we don't use thumbnail resolution during initialization
    return mapInitialized.value ? 0 : 0.2; // Above the LOW threshold in useImageResizer.ts
  }
  
  try {
    // AI : Get pixel bounds and calculate area
    const ne = map.value.latLngToContainerPoint(bounds.getNorthEast());
    const sw = map.value.latLngToContainerPoint(bounds.getSouthWest());
    
    // AI : Calculate visible area (clamp coordinates to viewport)
    const viewportWidth = mapSize.value.width;
    const viewportHeight = mapSize.value.height;
    
    // AI : Width and height of overlay in pixels
    const overlayWidth = Math.abs(ne.x - sw.x);
    const overlayHeight = Math.abs(ne.y - sw.y);
    
    // AI : Calculate area - this can exceed viewport area when zoomed in
    const overlayArea = overlayWidth * overlayHeight;
    const viewportArea = viewportWidth * viewportHeight;
    
    // AI : Return raw percentage (can be > 100% when zoomed in)
    return viewportArea > 0 ? (overlayArea / viewportArea) * 100 : 0.2; // AI : Default to small resolution if calculation fails
  } catch (error) {
    console.error('Error calculating screen coverage:', error);
    return 0.2; // AI : Default to small resolution if calculation fails
  }
}

function addTileLayer() {
  if (!map.value) return;
  L.tileLayer(
    'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal',
    {
      minZoom: 0,
      maxZoom: 22, // Allow zooming in further that the tiles maximum
      maxNativeZoom: 19, // Tiles only exist up to 19, upscale after
      tileSize: 256,
      attribution: "IGN-F/Géoportail",
      noWrap: true
    }
  ).addTo(map.value);
}

// AI : Restauration de la fonction de sauvegarde de la position de la carte
async function saveCurrentMapPosition() {
  if (!map.value) return;

  const center = map.value.getCenter();
  const zoom = map.value.getZoom();
  const position: MapPosition = { 
    key: 'position', 
    value: { 
      center: [center.lat, center.lng], 
      zoom 
    } 
  };

  await saveMapPosition(position);
}

export function disableLeafletKeyboardEvents() {
  if (!map.value) {
    console.error('Map is not initialized yet!');
    return;
  }

  const mapContainer = map.value.getContainer();
  if (!mapContainer) {
    console.error('Map container not found!');
    return;
  }

  // to prevent keystrokes from InfoPopup to be intercepted by Leaflet
  // unfortunately, it prevnts the user of the arrow keys to move the map (but there is prob a way around it)
  ['keydown', 'keyup', 'keypress'].forEach(eventType => {
    mapContainer.addEventListener(eventType, (e: Event) => {
      (e as KeyboardEvent).stopPropagation();
    }, true);
  });
}