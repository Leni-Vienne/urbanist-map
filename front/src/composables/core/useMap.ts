import L from "leaflet";
import { ref, shallowRef, nextTick } from 'vue';
import { debounce } from '../../utils';
import { addTileLayer } from '@composables/map/useTileLayers';

// shallowRef is used to avoid reactivity issues with Leaflet, see https://stackoverflow.com/a/73588115/12498040
export const map = shallowRef<L.Map | null>(null); 
export const mapSize = ref({ width: 0, height: 0 });
// AI : Flag to track if the map is fully initialized
export const mapInitialized = ref(false);
// AI : Reactive zoom level tracking
export const currentZoomLevel = ref<number>(13);

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
  // Fix Leaflet default marker icons for Vite build, credit to benneq : https://github.com/PaulLeCam/react-leaflet/issues/453#issuecomment-410450387
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: new URL('../../../../node_modules/leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
    iconUrl: new URL('../../../../node_modules/leaflet/dist/images/marker-icon.png', import.meta.url).href,
    shadowUrl: new URL('../../../../node_modules/leaflet/dist/images/marker-shadow.png', import.meta.url).href,
  });

  map.value = L.map("viewerDiv", { 
    maxZoom: 22,
    zoomControl: false
   }).setView([22, 10], 3);
  if (!map.value) throw new Error('No map element found');

  // AI : Initialize reactive zoom level with Leaflet's default
  currentZoomLevel.value = map.value.getZoom();
  
  // AI : Listen for zoom changes to update reactive zoom level
  map.value.on('zoomend', () => {
    if (map.value) {
      currentZoomLevel.value = map.value.getZoom();
    }
  });

  // AI : Save map dimensions
  debouncedUpdateMapSize();
  
  // AI : Update map size when window is resized (debounced to trigger only on resize end)
  window.addEventListener('resize', debouncedUpdateMapSize);

  addTileLayer();
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

// AI : Get current zoom level of the map
export function getCurrentZoom(): number | null {
  if (!map.value) {
    return null;
  }
  return map.value.getZoom();
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