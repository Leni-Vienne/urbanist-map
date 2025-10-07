import L from "leaflet";
import 'leaflet-doubletapdrag';
import 'leaflet-doubletapdragzoom';
import { ref, shallowRef } from 'vue';
import { debounce } from '../../utils';

// shallowRef is used to avoid reactivity issues with Leaflet, see https://stackoverflow.com/a/73588115/12498040
export const map = shallowRef<L.Map | null>(null);
const mapSize = ref({ width: 0, height: 0 });
// AI : Flag to track if the map is fully initialized
const mapInitialized = ref(false);
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
const debouncedUpdateMapSize = debounce(function () {
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
    initListeners.forEach(callback => { callback(); });
  }
}, 250);

// AI : Calculate minimum zoom based on viewport to avoid black borders
// AI : Higher resolution displays need higher minimum zoom to fill the viewport
function calculateMinZoom(): number {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const largerDimension = Math.max(viewportWidth, viewportHeight);

  // AI : For displays wider/taller than 2560px (typical 4K), use zoom level 3
  // AI : For standard HD (1920px and below), use zoom level 2
  // AI : Linear interpolation between these thresholds
  if (largerDimension >= 2560) {
    return 3;
  } else if (largerDimension <= 1920) {
    return 2;
  } else {
    // AI : Interpolate between 2 and 3 for resolutions between 1920 and 2560
    return 2 + ((largerDimension - 1920) / (2560 - 1920));
  }
}

export function initializeMap() {
  // AI : Detect mobile device for conditional zoom settings
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  map.value = L.map("mapDiv", {
    minZoom: calculateMinZoom(),
    maxZoom: 22,
    zoomControl: false, // because we have our own zoom control
    maxBounds: L.latLngBounds([-85, -180], [85, 180]),
    maxBoundsViscosity: 0.8, // gently bounce back
    // AI : Enable smooth zoom with no snapping only on mobile
    ...(isMobile && {
      zoomSnap: 0,
      zoomDelta: 0.1,
      // AI : Enable inertia for smooth momentum on all interactions
      inertia: true,
      inertiaDeceleration: 2400, // slightly slower deceleration for smoother feel
      inertiaMaxSpeed: 1500, // reasonable max speed limit
      // AI : Enable bouncing at zoom limits for better UX
      bounceAtZoomLimits: true,
    }),
    touchZoom: true,
    doubleTapDragZoom: true,
    doubleTapDragZoomOptions: {
      reverse: true,
    },
  }).setView([22, 10], calculateMinZoom());
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

  L.control.scale().addTo(map.value);
  // AI : Ensure the map initialization is complete
  if (map.value) {
    map.value.invalidateSize();
    debouncedUpdateMapSize();
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
      e.stopPropagation();
    }, true);
  });
}
