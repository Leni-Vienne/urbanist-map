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
import { onMounted, ref, onUnmounted, shallowRef  } from 'vue';

const map = shallowRef <L.Map | null>(null); // shallowRef is used to avoid reactivity issues with Leaflet, see https://stackoverflow.com/a/73588115/12498040
const overlay = shallowRef<L.ImageOverlay | null>(null);
const imageUrl = ref<string | null>(null);
const history = ref<{ lat: number, lng: number }[][]>([]);
const redoStack = ref<{ lat: number, lng: number }[][]>([]);
const isEditMode = ref<boolean>(true); // Track edit mode

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

function onImageUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    imageUrl.value = URL.createObjectURL(file);
    addOverlay();
  }
}

async function addOverlay() {
  if (map.value && imageUrl.value) {
    if (overlay.value) map.value.removeLayer(overlay.value);

    const img = new Image();
    img.onload = async () => {
      overlay.value = await L.distortableImageOverlay(imageUrl.value, {
        editable: isEditMode.value // Set editable based on current mode
      }).addTo(map.value); // Add overlay to the map

      // Listen for image move events and save to history
      overlay.value.on('edit', saveToHistory);

    };
    img.src = imageUrl.value; // Set the image source
  }
}

function saveToHistory() {
  if (overlay.value) {
    // creates a deep copy of the corners, otherwise the history will all be a reference to the same object
    const currentState = JSON.parse(JSON.stringify(overlay.value.getCorners()));
    history.value.push(currentState);
  }
  redoStack.value = [];
}

function undo() {
  if (history.value.length > 1 && overlay.value) {
    redoStack.value.push(history.value.pop()!);
    overlay.value.setCorners(history.value[history.value.length - 1]);
  }
}

function redo() {
  if (redoStack.value.length > 0 && overlay.value) {
    history.value.push(redoStack.value.pop()!);
    overlay.value.setCorners(history.value[history.value.length - 1]);
  }
}

async function saveImageAndPosition() {
  if (overlay.value) {
    const corners = overlay.value.getCorners();
  }
}

function toggleEditMode() {
  isEditMode.value = !isEditMode.value;
  if (overlay.value) {
    if (isEditMode.value) {
      overlay.value.editing.enable();
    } else {
      overlay.value.editing.disable();
    }
  }
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
