import L from "leaflet";
import { ref, shallowRef, nextTick } from 'vue';
import { getSavedMapPosition, saveMapPosition } from '@composables/core/useDatabase';
import type { MapPosition } from '@types';
import { debounce } from '../../utils';
import { addTileLayer } from '@composables/map/useTileLayers';

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

  // AI : Check for coordinates in URL first
  let urlCenter: [number, number] | null = null;
  let urlZoom: number | null = null;
  
  try {
    const url = new URL(window.location.href);
    const lat = url.searchParams.get('lat');
    const lng = url.searchParams.get('lng');
    const zoom = url.searchParams.get('zoom');
    
    if (lat && lng) {
      urlCenter = [parseFloat(lat), parseFloat(lng)];
    }
    
    if (zoom) {
      urlZoom = parseInt(zoom, 10);
    }
  } catch (error) {
    console.error('Error parsing URL params:', error);
  }
  
  // AI : Use URL params if present, then saved position, then defaults
  const center = urlCenter || (savedPosition ? savedPosition.center : [defaultLat, defaultLng]);
  const zoom = urlZoom || (savedPosition ? savedPosition.zoom : defaultZoom);

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
  L.control.scale().addTo(map.value);
  // AI : Ensure the map initialization is complete
  // AI : Use nextTick for better timing than arbitrary timeout
  nextTick(() => {
    if (map.value) {
      map.value.invalidateSize();
      debouncedUpdateMapSize();
    }
  });
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

  // Update URL with position without affecting history
  updateUrlWithPosition(center.lat, center.lng, zoom);

  await saveMapPosition(position);
}

// AI : Update URL with map coordinates and zoom without affecting history
export function updateUrlWithPosition(lat: number, lng: number, zoom: number): void {
  try {
    const url = new URL(window.location.href);
    
    // Set the map position query parameters
    url.searchParams.set('lat', lat.toFixed(6));
    url.searchParams.set('lng', lng.toFixed(6));
    url.searchParams.set('zoom', zoom.toString());
    
    // Replace current URL without adding to history stack
    window.history.replaceState(window.history.state, '', url.toString());
  } catch (error) {
    console.error('Error updating URL with map position:', error);
  }
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