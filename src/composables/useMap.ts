import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated';
import { ref, shallowRef } from 'vue';
import { getSavedMapPosition, saveMapPosition } from './useDatabase';
import type { MapPosition } from '../types';
import { debounce } from '../utils';

export const map = shallowRef<L.Map | null>(null);
export const mapSize = ref({ width: 0, height: 0 });

// Create a debounced version of updateMapSize
export const debouncedUpdateMapSize = debounce(function() {
  if (!map.value) return;
  const container = map.value.getContainer();
  mapSize.value = {
    width: container.clientWidth,
    height: container.clientHeight
  };
  
  // Trigger a resize event on the map to ensure all components adjust
  map.value.invalidateSize();
}, 250);

export async function initializeMap() {
  const savedPosition = await getSavedMapPosition();

  // Default coordinates for Paris if no saved position is found
  const defaultLat = 48.8566;
  const defaultLng = 2.3522;
  const defaultZoom = 13;

  // Use saved position or defaults
  const center = savedPosition ? savedPosition.center : [defaultLat, defaultLng];
  const zoom = savedPosition ? savedPosition.zoom : defaultZoom;

  const initialView: L.LatLngExpression = { lat: center[0], lng: center[1] };

  map.value = L.map("viewerDiv", { maxZoom: 22 }).setView(initialView, zoom);
  if (!map.value) throw new Error('No map element found');

  // Save map dimensions
  debouncedUpdateMapSize();
  
  // Update map size when window is resized (debounced to trigger only on resize end)
  window.addEventListener('resize', debouncedUpdateMapSize);

  // Save default position if none exists
  if (!savedPosition) {
    await saveCurrentMapPosition();
  }

  addTileLayer();
  map.value.on('moveend zoomend', saveCurrentMapPosition);
}

// Calculate how much of the screen an overlay covers (as a percentage)
export function calculateScreenCoverage(bounds: L.LatLngBounds): number {
  if (!map.value || !bounds?.isValid?.()) {
    bounds && !bounds.isValid() && console.warn('Invalid bounds object passed to calculateScreenCoverage');
    return 0;
  }
  
  try {
    // Get pixel bounds and calculate area
    const ne = map.value.latLngToContainerPoint(bounds.getNorthEast());
    const sw = map.value.latLngToContainerPoint(bounds.getSouthWest());
    const overlayArea = Math.abs(ne.x - sw.x) * Math.abs(ne.y - sw.y);
    
    // Calculate and return coverage percentage
    const viewportArea = mapSize.value.width * mapSize.value.height;
    return viewportArea > 0 ? (overlayArea / viewportArea) * 100 : 0;
  } catch (error) {
    console.error('Error calculating screen coverage:', error);
    return 0;
  }
}

function addTileLayer() {
  if (!map.value) return;
  L.tileLayer(
    'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal',
    {
      minZoom: 0,
      maxZoom: 22,
      maxNativeZoom: 19,
      tileSize: 256,
      attribution: "IGN-F/Géoportail",
      noWrap: true
    }
  ).addTo(map.value);
}

// Restauration de la fonction de sauvegarde de la position de la carte
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
  
  map.value.keyboard.disable();

  const mapContainer = map.value.getContainer();
  if (!mapContainer) {
    console.error('Map container not found!');
    return;
  }

  ['keydown', 'keyup', 'keypress'].forEach(eventType => {
    mapContainer.addEventListener(eventType, (e: Event) => {
      (e as KeyboardEvent).stopPropagation();
    }, true);
  });
}