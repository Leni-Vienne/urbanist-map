<template>
  <div id="viewerDiv" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;">
    <div class="map-buttons">
      <input type="file" @change="onImageUpload" accept="image/png, image/jpeg" />
      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="saveImageAndPosition">Save image</Button>
        </div>
      </div>
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
import { onMounted, ref, onUnmounted, shallowRef } from 'vue';

interface overlayObject {
  id: string;
  overlay: L.ImageOverlay;
  marker: L.Marker; // Add marker property
  history: { lat: number, lng: number }[][];
  redoStack: { lat: number, lng: number }[][];
  isNewImage: boolean;
}

const map = shallowRef<L.Map | null>(null); // shallowRef is used to avoid reactivity issues with Leaflet, see https://stackoverflow.com/a/73588115/12498040
const overlays = shallowRef<Record<string, overlayObject>>({}); // Store overlays as a Record
const idSelectedOverlay = ref<string | null>(null); // Track the ID of the currently selected overlay
const imageUrl = ref<string | null>(null);
const isEditMode = ref<boolean>(true);

onMounted(() => {
  const savedPosition = localStorage.getItem('mapPosition');
  const initialView = savedPosition ? JSON.parse(savedPosition) : { center: [48.845, 2.424], zoom: 10 };

  map.value = L.map("viewerDiv").setView(initialView.center, initialView.zoom);

  if (!map.value) throw new Error('No map element found');

  L.tileLayer(
    'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal',
    {
      minZoom: 0,
      maxZoom: 19, // TODO cannot go to 20 with data.geopf.fr, I need to search why
      tileSize: 256,
      attribution: "IGN-F/Géoportail"
    }
  ).addTo(map.value);

  map.value.on('moveend', saveMapPosition);
  map.value.on('zoomend', saveMapPosition);

  window.addEventListener('keydown', handleKeyDown);
});

function handleKeyDown(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === 'z') {
    undo();
  } else if (event.ctrlKey && event.key === 'y') {
    redo();
  }
}

function saveMapPosition() {
  if (map.value) {
    const center = map.value.getCenter();
    const zoom = map.value.getZoom();
    localStorage.setItem('mapPosition', JSON.stringify({ center: [center.lat, center.lng], zoom }));
  }
}

async function onImageUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    imageUrl.value = URL.createObjectURL(file);
    await addOverlay();
  }
}

const CustomAction = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      html: '<img src="https://cdn-icons-png.flaticon.com/512/25/25231.png" alt="Custom Icon" style="width: 20px; height: 20px;" />', // Icône provenant d'Internet
      tooltip: 'Custom Action',
    },
  },
  addHooks: function () {
    alert('Custom action triggered!');
  },
});

async function createOverlay(imageUrl: string, overlayObject?: overlayObject ) {
  if (!map.value) return null;

  const newOverlay = await new L.distortableImageOverlay(imageUrl, {
    editable: isEditMode.value,
  }).addTo(map.value);

  if (overlayObject) {
    overlayObject.overlay = newOverlay;

    newOverlay.on('edit', () => {
      saveToHistory(overlayObject);
      updateMarkerPosition(overlayObject);
    });
    newOverlay.on('dragend', () => {
      saveToHistory(overlayObject);
      updateMarkerPosition(overlayObject);
    });
    newOverlay.on('select', () => {
      idSelectedOverlay.value = overlayObject.id;
    });

    //allows to access corners of the image on load since newOverlay.on('load') doesn't work, credit to https://github.com/publiclab/Leaflet.DistortableImage/issues/953#issuecomment-1262298228
    L.DomEvent.on(newOverlay.getElement(), 'load', () => {
      if (overlayObject.isNewImage) {
        saveToHistory(overlayObject);
        overlayObject.marker = createMarker(overlayObject);
      } else {
        // for the modified image to keep the same position as before
        overlayObject.overlay.setCorners(overlayObject.history.at(-1));
      }
      // isNewImage must be updated there otherwise it is set to false too early
      overlayObject.isNewImage = false
    });
  }
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

async function addOverlay() {
  if (!map.value || !imageUrl.value) return;

  const id = crypto.randomUUID();
  const overlayObject = {
    id,
    overlay: null as L.ImageOverlay,
    marker: null as L.Marker,
    history: [],
    redoStack: [],
    isNewImage: true
  };

  const newOverlay = await createOverlay(imageUrl.value, overlayObject);
  if (!newOverlay) return;

  overlays.value[id] = overlayObject;
}

function saveToHistory(overlayObject: { id: string, overlay: L.ImageOverlay, history: { lat: number, lng: number }[][], redoStack: { lat: number, lng: number }[][] }) {
  const currentState = JSON.parse(JSON.stringify(overlayObject.overlay.getCorners()));
  overlayObject.history.push(currentState);
  overlayObject.redoStack = []; // Clear redo stack for this overlay
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
}

async function saveImageAndPosition() {
  if (!idSelectedOverlay.value) return;

}

function toggleEditMode() {
  isEditMode.value = !isEditMode.value;

  Object.values(overlays.value).forEach(overlayObject => {
    if (isEditMode.value) {
      overlayObject.overlay.editing.enable();
    } else {
      overlayObject.overlay.editing.disable();
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
