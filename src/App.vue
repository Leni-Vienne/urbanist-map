<template>
  <main>
    <div id="viewerDiv" style="height: 70vh; width: 70vw;"></div>
    <div>
      <input type="file" @change="onImageUpload" accept="image/png, image/jpeg" />
      <label>
        Corners (Lat, Lng):
        <div v-for="(corner, index) in corners" :key="index">
          Corner {{ index + 1 }}:
          <input type="number" v-model="corner.lat" step="0.0001" @input="debouncedUpdateOverlay(false)" />,
          <input type="number" v-model="corner.lng" step="0.0001" @input="debouncedUpdateOverlay(false)" />
        </div>
      </label>
      <div class="card flex justify-center">
        <div class="w-56">
          <InputNumber v-model.number="opacity" class="w-full mb-4" @change="debouncedUpdateOverlay(false)" />
          <br>Opacity : <br>
          <Slider v-model.number="opacity" class="w-full mb-4" @change="debouncedUpdateOverlay(false)" />
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
import "leaflet-distortableimage/dist/leaflet.distortableimage.css";
import { onMounted, ref } from 'vue';
import { debounce } from 'lodash';

const map = ref<L.Map | null>(null);
const overlay = ref<L.ImageOverlay | null>(null);
const corners = ref<{ lat: number, lng: number }[]>([]);
const imageUrl = ref<string | null>(null);
const opacity = ref<number>(50);

onMounted(() => {
  const savedPosition = localStorage.getItem('mapPosition');
  const initialView = savedPosition ? JSON.parse(savedPosition) : { center: [48.845, 2.424], zoom: 10 };

  map.value = L.map("viewerDiv", { keyboard: false }).setView(initialView.center, initialView.zoom);

  if (!map.value) throw new Error('No map element found');

  L.tileLayer(
    'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal',
    {
      minZoom: 0,
      maxZoom: 18,
      tileSize: 256,
      attribution: "IGN-F/Géoportail"
    }
  ).addTo(map.value);

  

  map.value.on('moveend', saveMapPosition);
  map.value.on('zoomend', saveMapPosition);
});

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
        opacity: opacity.value / 100,
      }).addTo(map.value);
    };
    await Promise.all(img.src = imageUrl.value);
    updateOverlay();
  }
}

function updateOverlay() {
  if (overlay.value) {
    if (corners.value.length === 0) {
      corners.value = overlay.value.getCorners();
    }

    overlay.value.setCorners(corners.value);
    overlay.value.setOpacity(opacity.value / 100);
  }
}

const debouncedUpdateOverlay = debounce(updateOverlay, 300);
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
