<template>
  <div id="viewerDiv" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;">
    <div class="map-buttons">
      <input type="file" @change="onImageUpload" accept="image/png, image/jpeg" />
      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="toggleEditMode">{{ isEditMode ? 'Switch to View Mode' : 'Switch to Edit Mode' }}</Button>
        </div>
      </div>
      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="removeWhitePixels">Remove White Pixels</Button>
        </div>
      </div>
      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="clearIndexedDB">Clear Local Storage</Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated'; // using "-updated" to prevent "WebSocket connection to 'ws://localhost:8081/ws' failed:" error
import 'leaflet/dist/leaflet.css';
import 'leaflet-toolbar/dist/leaflet.toolbar.css';
import "leaflet-distortableimage-updated/dist/leaflet.distortableimage.css";
import './assets/style.css' // must be imported otherwise it's overwritten by leaflet's default css
import { onMounted, ref, onUnmounted, shallowRef, watch } from 'vue';
import { openDB } from 'idb'; // Import the idb library

type overlayObject = {
  id: string;
  overlay: L.ImageOverlay;
  marker: L.Marker;
  history: { lat: number, lng: number }[][];
  redoStack: { lat: number, lng: number }[][];
  alreadyLoaded: boolean; // Track if the overlay is already loaded in the page
  alreadyStored: boolean; // Track if the overlay is already stored in IndexedDB
}

const map = shallowRef<L.Map | null>(null); // shallowRef is used to avoid reactivity issues with Leaflet, see https://stackoverflow.com/a/73588115/12498040
const overlays = shallowRef<Record<string, overlayObject>>({}); // Store overlays as a Record
const idSelectedOverlay = ref<string | null>(null); // Track the ID of the currently selected overlay
const imageUrl = ref<string | null>(null);
const isEditMode = ref<boolean>(true);
let db: IDBDatabase | null = null;

onMounted(async () => {
  await initializeDatabase();
  await initializeMap();
  window.addEventListener('keydown', handleKeyDown); // to handle undo/redo with ctrl+z and ctrl+y
  await getOverlaysFromIndexedDB();
});

async function initializeDatabase() {
  db = await openDB('CityMapOverlayDB', 1, {
    upgrade(upgradeDb) {
      if (!upgradeDb.objectStoreNames.contains('overlays')) {
        upgradeDb.createObjectStore('overlays', { keyPath: 'id' });
      }
      if (!upgradeDb.objectStoreNames.contains('mapPosition')) {
        upgradeDb.createObjectStore('mapPosition', { keyPath: 'key' });
      }
    },
  });
}

async function initializeMap() {
  const savedPosition = await getSavedMapPosition();
  const initialView = savedPosition || { center: [48.845, 2.424], zoom: 10 };

  map.value = L.map("viewerDiv").setView(initialView.center, initialView.zoom);
  if (!map.value) throw new Error('No map element found');

  addTileLayer();
  map.value.on('moveend', saveMapPosition);
  map.value.on('zoomend', saveMapPosition);
}

async function getSavedMapPosition() {
  if (!db) return null;
  const savedPosition = await db.get('mapPosition', 'position');
  return savedPosition ? savedPosition.value : null;
}

function addTileLayer() {
  L.tileLayer(
    'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal',
    {
      minZoom: 0,
      maxZoom: 19, // TODO cannot go to 20 with data.geopf.fr, I need to search why
      tileSize: 256,
      attribution: "IGN-F/Géoportail"
    }
  ).addTo(map.value);
}

async function getOverlaysFromIndexedDB() {
  if (!db) return;

  const savedOverlays = await fetchSavedOverlays();
  savedOverlays.forEach(async (savedOverlay) => {
    const overlayObject = createOverlayObject(savedOverlay);
    const newOverlay = await createOverlay(savedOverlay.imageUrl, overlayObject);
    overlayObject.overlay = newOverlay!;
    overlays.value[savedOverlay.id] = overlayObject;
  });
}

async function fetchSavedOverlays() {
  const transaction = db.transaction('overlays', 'readonly');
  const store = transaction.objectStore('overlays');
  return await store.getAll();
}

function createOverlayObject(savedOverlay: { id: string, imageUrl: string, corners: { lat: number, lng: number }[] }) {
  return {
    id: savedOverlay.id,
    overlay: null as L.ImageOverlay,
    marker: null as L.Marker,
    history: [savedOverlay.corners],
    redoStack: [],
    alreadyLoaded: false,
    alreadyStored: true
  };
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === 'z') {
    undo();
  } else if (event.ctrlKey && event.key === 'y') {
    redo();
  }
}

async function onImageUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    imageUrl.value = reader.result as string; // Store base64 string
    await addOverlay();
  };
  reader.readAsDataURL(file); // Convert file to base64
}

const centerTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      html: '<span>Center Map</span>',
      tooltip: 'Center map on the selected overlay',
    },
  },
  addHooks: function () {
    if (!idSelectedOverlay.value) {
      alert('No overlay selected!');
      return;
    }
    const overlayObject = overlays.value[idSelectedOverlay.value];
    if (overlayObject) {
      const bounds = overlayObject.overlay.getBounds();
      map.value?.fitBounds(bounds);
    }
  },
})

const undoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      html: '<span>Undo</span>',
      tooltip: 'Revert overlay to last saved state',
    },
  },
  addHooks: function () {
    undo();
  },
})

const redoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      html: '<span>Redo</span>',
      tooltip: 'Redo overlay to last saved state',
    },
  },
  addHooks: function () {
    redo();
  },
})

// all actions (not all in docs) : L.DistortAction, L.FreeRotateAction, L.OpacityAction, L.DeleteAction, L.StackAction, L.EditAction, L.RotateAction, L.ScaleAction, L.TranslateAction, L.OpacitiesAction, L.GeolocateAction, L.RestoreAction, L.UnlockAction
// L.EditAction is empty
// L.TranslateAction crashes
// L.UnlockAction is useless
// L.GeolocateAction crashes "ReferenceError: EXIF is not defined"
// L.RestoreAction undistorts the image
// L.OpacitiesAction works well!
const editTools = [undoTool, redoTool, L.DistortAction, L.FreeRotateAction, L.OpacityAction, L.OpacitiesAction, L.DeleteAction, L.StackAction]
const viewTools = [centerTool, L.OpacityAction, L.OpacitiesAction, L.StackAction]


async function createOverlay(imageUrl: string, overlayObject?: overlayObject) {
  if (!map.value || !overlayObject) return null;

  const newOverlay = L.distortableImageOverlay(imageUrl, {
    editable: true,
    //actions: editTools,
    // can't use the editTools array since switch to view mode and back will empty it...
    actions: [undoTool, redoTool, L.DistortAction, L.FreeRotateAction, L.OpacityAction, L.OpacitiesAction, L.DeleteAction, L.StackAction]
  }).addTo(map.value);

  overlayObject.overlay = newOverlay;

  newOverlay.on('edit', () => {
    saveToHistory(overlayObject);
    saveImageAndPosition();
    updateMarkerPosition(overlayObject);
  });
  newOverlay.on('dragend', () => {
    saveToHistory(overlayObject);
    saveImageAndPosition();
    updateMarkerPosition(overlayObject);
  });
  newOverlay.on('select', () => {
    idSelectedOverlay.value = overlayObject.id;
  });

  // allows to access the corners of the image on load since newOverlay.on('load') doesn't work
  // credit to https://github.com/publiclab/Leaflet.DistortableImage/issues/953#issuecomment-1262298228
  L.DomEvent.on(newOverlay.getElement(), 'load', () => {
    if (overlayObject.alreadyStored || overlayObject.alreadyLoaded) {
      overlayObject.overlay.setCorners(overlayObject.history.at(-1));
    }

    if (!overlayObject.alreadyLoaded) {
      saveToHistory(overlayObject);
      overlayObject.marker = createMarker(overlayObject);
    }

    overlayObject.alreadyLoaded = true
    overlayObject.alreadyStored = true
  });
  return newOverlay;
}

function createMarker(overlayObject: overlayObject) {
  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  const marker = L.marker(center).addTo(map.value);
  return marker;
}

function updateMarkerPosition(overlayObject: overlayObject) {
  const bounds = overlayObject.overlay.getBounds();
  const center = bounds.getCenter();
  overlayObject.marker.setLatLng(center);
}

async function saveMapPosition() {
  if (!map.value || !db) return;

  const center = map.value.getCenter();
  const zoom = map.value.getZoom();
  const position = { key: 'position', value: { center: [center.lat, center.lng], zoom } };

  const transaction = db.transaction('mapPosition', 'readwrite');
  const store = transaction.objectStore('mapPosition');
  await store.put(position);
}

async function saveImageAndPosition() {
  if (!db) return;

  const savedOverlays = Object.values(overlays.value).map(overlayObject => ({
    id: overlayObject.id,
    imageUrl: overlayObject.overlay.getElement().src,
    corners: overlayObject.overlay.getCorners(),
    history: overlayObject.history,
    redoStack: overlayObject.redoStack,
  }));

  await saveOverlaysToDB(savedOverlays);
}

async function saveOverlaysToDB(overlays: { id: string, imageUrl: string, corners: { lat: number, lng: number }[], history: { lat: number, lng: number }[][], redoStack: { lat: number, lng: number }[][] }[]) {
  const transaction = db.transaction('overlays', 'readwrite');
  const store = transaction.objectStore('overlays');
  for (const overlay of overlays) {
    await store.put(overlay);
  }
}

function saveToHistory(overlayObject: { id: string, overlay: L.ImageOverlay, history: { lat: number, lng: number }[][], redoStack: { lat: number, lng: number }[][] }) {
  const currentState = JSON.parse(JSON.stringify(overlayObject.overlay.getCorners()));
  overlayObject.history.push(currentState);
  overlayObject.redoStack = []; // Clear redo stack for this overlay
}

async function addOverlay() {
  if (!map.value || !imageUrl.value) return;

  const id = crypto.randomUUID();
  const overlayObject = {
    id,
    overlay: null as L.ImageOverlay,
    marker: null as L.Marker,
    history: [],
    redoStack: [],
    alreadyLoaded: false,
    alreadyStored: false // Set to false since it's a new overlay
  };

  const newOverlay = await createOverlay(imageUrl.value, overlayObject);
  if (!newOverlay) return;

  overlays.value[id] = overlayObject;
}

function undo() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject) return;

  const { history, redoStack, overlay } = overlayObject;
  if (history.length <= 1) return;

  const lastState = history.pop()!;
  redoStack.push(lastState);

  const previousState = history[history.length - 1];
  overlay.setCorners(previousState);

  updateMarkerPosition(overlayObject);
}

function redo() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject) return;

  const { history, redoStack, overlay } = overlayObject;
  if (redoStack.length === 0) return;

  const nextState = redoStack.pop()!;
  history.push(nextState);

  overlay.setCorners(nextState);

  updateMarkerPosition(overlayObject);
}

function toggleEditMode() {
  isEditMode.value = !isEditMode.value;

  // adding and removing tools is finicky (tools are often removed from the arrays) but this way works
  Object.values(overlays.value).forEach((overlayObject) => {
    const editing = overlayObject.overlay.editing;

    if (isEditMode.value) {
      viewTools.forEach((tool) => editing.removeTool(tool));
      editTools.forEach((tool) => editing.addTool(tool));
    } else {
      editTools.forEach((tool) => editing.removeTool(tool));
      viewTools.forEach((tool) => editing.addTool(tool));
    }
  });
}

async function removeWhitePixels() {
  if (!idSelectedOverlay.value) return;

  const overlayObject = overlays.value[idSelectedOverlay.value];
  if (!overlayObject) return;

  const { overlay } = overlayObject;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  img.onload = async () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = data[i + 3];

      // Check if the pixel has the same red, green, and blue values
      if (r === g && g === b && alpha > 0) {
        data[i + 3] = 0; // Set alpha to 0 (make pixel transparent)
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const updatedImageUrl = canvas.toDataURL();

    map.value.removeLayer(overlay);
    await createOverlay(updatedImageUrl, overlayObject);
  };
  img.src = overlay.getElement().src; // what is actually updating the image
}

function clearIndexedDB() {
  if (!db) return;

  const transactionOverlays = db.transaction('overlays', 'readwrite');
  const storeOverlays = transactionOverlays.objectStore('overlays');
  storeOverlays.clear();

  const transactionMapPosition = db.transaction('mapPosition', 'readwrite');
  const storeMapPosition = transactionMapPosition.objectStore('mapPosition');
  storeMapPosition.clear();

  alert('IndexedDB cleared!');
}

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<style scoped>
header {
  line-height: 1.5;
}

.logo {
  display: block;
  margin: 0 auto 2rem;
}

@media (min-width: 1024px) {
  header {
    display: flex;
    place-items: center;
    padding-right: calc(var(--section-gap) / 2);
  }

  .logo {
    margin: 0 2rem 0 0;
  }

  header .wrapper {
    display: flex;
    place-items: flex-start;
    flex-wrap: wrap;
  }
}

.map-buttons {
  position: absolute;
  top: 80px;
  left: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

#viewerDiv {
  width: 100%;
  height: 100%;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
