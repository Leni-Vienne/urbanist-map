<template>
  <main>
    <div id="viewerDiv" style="height: 70vh; width: 70vw;"></div>
    <div>
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
  </main>
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

const map = shallowRef<L.Map | null>(null); // shallowRef is used to avoid reactivity issues with Leaflet, see https://stackoverflow.com/a/73588115/12498040
const overlays = shallowRef<{
  id: string,
  overlay: L.ImageOverlay,
  history: { lat: number, lng: number }[][],
  redoStack: { lat: number, lng: number }[][],
  isNewImage: boolean
}[]>([]); // Store overlays with their properties
const selectedOverlay = ref<string | null>(null); // Track the ID of the currently selected overlay
const imageUrl = ref<string | null>(null);
const isEditMode = ref<boolean>(true); // Track edit mode

const testOverlay = shallowRef<L.ImageOverlay | null>(null); // Track the test overlay

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
    await addOverlay(true); // Pass true to indicate it's a new image
  }
}

async function createOverlay(imageUrl: string, isEditable: boolean, overlayObject?: { id: string, history: { lat: number, lng: number }[][], redoStack: { lat: number, lng: number }[][] }) {
  if (!map.value) return null;

  const newOverlay = await L.distortableImageOverlay(imageUrl, {
    editable: isEditable
  }).addTo(map.value);

  if (overlayObject) {
    overlayObject.overlay = newOverlay;

    // Reattach event listeners
    newOverlay.on('edit', () => saveToHistory(overlayObject));
    newOverlay.on('dragend', () => saveToHistory(overlayObject));
    newOverlay.on('select', () => {
      selectedOverlay.value = overlayObject.id;
    });
  }

  return newOverlay;
}

async function addOverlay(isNewImage: boolean) {
  if (!map.value || !imageUrl.value) return;

  const id = crypto.randomUUID();
  const overlayObject = {
    id,
    overlay: null as unknown as L.ImageOverlay,
    history: [],
    redoStack: [],
    isNewImage
  };

  const newOverlay = await createOverlay(imageUrl.value, isEditMode.value, overlayObject);
  if (!newOverlay) return;

  if (isNewImage) {
    newOverlay.once('update', () => {
      saveToHistory(overlayObject);
    });
  }

  overlays.value.push(overlayObject);
}

function saveToHistory(overlayObject: { id: string, overlay: L.ImageOverlay, history: { lat: number, lng: number }[][], redoStack: { lat: number, lng: number }[][] }) {
  const currentState = JSON.parse(JSON.stringify(overlayObject.overlay.getCorners()));
  overlayObject.history.push(currentState);
  overlayObject.redoStack = []; // Clear redo stack for this overlay
}

function undo() {
  if (!selectedOverlay.value) return;

  const overlayObject = overlays.value.find(o => o.id === selectedOverlay.value);
  if (!overlayObject) return;

  const { history, redoStack, overlay } = overlayObject;
  if (history.length <= 1) return;

  const lastState = history.pop()!; // Remove the last state
  redoStack.push(lastState); // Push it to the redo stack

  // Apply the previous state
  const previousState = history[history.length - 1];
  overlay.setCorners(previousState);
}

function redo() {
  if (!selectedOverlay.value) return;

  const overlayObject = overlays.value.find(o => o.id === selectedOverlay.value);
  if (!overlayObject) return;

  const { history, redoStack, overlay } = overlayObject;
  if (redoStack.length === 0) return;

  const nextState = redoStack.pop()!; // Remove the next state
  history.push(nextState); // Push it to the history stack

  // Apply the next state
  overlay.setCorners(nextState);
}

async function saveImageAndPosition() {
  if (!selectedOverlay.value) return;

  const overlayObject = overlays.value.find(o => o.id === selectedOverlay.value);
  if (!overlayObject) return;

  const corners = overlayObject.overlay.getCorners();
}

function toggleEditMode() {
  isEditMode.value = !isEditMode.value;
  if (!selectedOverlay.value) return

  const overlayObject = overlays.value.find(o => o.id === selectedOverlay.value);
  if (!overlayObject) return

  if (isEditMode.value) {
    overlayObject.overlay.editing.enable();
  } else {
    overlayObject.overlay.editing.disable();
  }
}

async function removeWhitePixels() {
  if (!selectedOverlay.value) return; // Only act on the selected overlay

  const overlayObject = overlays.value.find(o => o.id === selectedOverlay.value);
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
    const updatedImageUrl = canvas.toDataURL(); // Get the updated image URL

    // Update the selected overlay with the modified image
    map.value?.removeLayer(overlay);
    await createOverlay(updatedImageUrl, isEditMode.value, overlayObject);
  };
  img.src = overlay.getElement().src; // Get the source of the selected overlay
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
</style>
