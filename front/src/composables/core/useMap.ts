import L from "leaflet";
import { ref, shallowRef } from 'vue';
import { debounce } from '@utils/debounce';

// shallowRef is used to avoid reactivity issues with Leaflet, see https://stackoverflow.com/a/73588115/12498040
export const map = shallowRef<L.Map | null>(null);
const mapSize = ref({ width: 0, height: 0 });
// AI : Reactive zoom level tracking
export const currentZoomLevel = ref<number>(13);

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

  map.value = L.map("mapDiv", {
    minZoom: calculateMinZoom(),
    maxZoom: 22,
    zoomControl: false, // because we have our own zoom control
    maxBounds: L.latLngBounds([-85, -180], [85, 180]),
    maxBoundsViscosity: 0.8, // gently bounce back
    touchZoom: true, // true otherwise the website is zoomed instead of the map on mobile,
    keyboard: false,
    /*...(isMobile && {
      zoomSnap: 0,
      zoomDelta: 0.25,
      // AI : Enable inertia for smooth momentum on all interactions
      inertia: true,
      inertiaDeceleration: 1500, // slightly slower deceleration for smoother feel
      inertiaMaxSpeed: 1500, // reasonable max speed limit
      // AI : Enable bouncing at zoom limits for better UX
    }),
    // attempted to use double-tap-drag to zoom on mobile, it's really bad (unwanted movement, especially when doing short repeated drags)
    doubleTapDragZoom: true,
    doubleTapDragZoomOptions: {
      reverse: true,
    },*/
  }).setView([22, 10], calculateMinZoom());
  if (!map.value) throw new Error('No map element found');

  // AI : Initialize reactive zoom level with Leaflet's default
  currentZoomLevel.value = map.value.getZoom();

  // AI : Listen for zoom changes to update reactive zoom level
  map.value.on('zoomend', () => {
    if (map.value != null) {
      currentZoomLevel.value = map.value.getZoom();
    }
  });

  // AI : Save map dimensions
  debouncedUpdateMapSize();

  // AI : Update map size when window is resized (debounced to trigger only on resize end)
  window.addEventListener('resize', debouncedUpdateMapSize);

  L.control.scale().addTo(map.value);
  // AI : Ensure the map initialization is complete
  if (map.value != null) {
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
