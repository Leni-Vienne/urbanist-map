import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated';
import { ref, shallowRef } from 'vue';
import { getSavedMapPosition, saveMapPosition } from './useDatabase';
import type { mapPosition } from '../types';

export const map = shallowRef<L.Map | null>(null);

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

  // Save default position if none exists
  if (!savedPosition) {
    await saveCurrentMapPosition();
  }

  addTileLayer();
  map.value.on('moveend', saveCurrentMapPosition);
  map.value.on('zoomend', saveCurrentMapPosition);
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

async function saveCurrentMapPosition() {
  if (!map.value) return;

  const center = map.value.getCenter();
  const zoom = map.value.getZoom();
  const position: mapPosition = { 
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