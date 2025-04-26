<template>
  <Toast />
  <div
    id="viewerDiv"
    style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;"
  >
    <div class="map-buttons">
      <input
        type="file"
        @change="onImageUpload"
        accept="image/png, image/jpeg"
      />
      <div class="card flex">
        <Drawer
          v-model:visible="visible"
          header="Drawer"
          :dismissableMask="true"
        >
          <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et
            dolore magna aliqua.</p>
        </Drawer>
        <Button
          icon="pi pi-bars"
          @click="visible = true"
        />
      </div>
      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="toggleEditMode">{{ isEditMode ? 'Switch to View Mode' : 'Switch to Edit Mode' }}</Button>
        </div>
      </div>
      <div class="card flex justify-center">
        <div class="w-56">
          <Button @click="clearDatabase">Clear Local Storage</Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import 'leaflet/dist/leaflet.css';
import 'leaflet-toolbar/dist/leaflet.toolbar.css';
import "leaflet-distortableimage-updated/dist/leaflet.distortableimage.css";
import './assets/style.css'
import 'primeicons/primeicons.css'

import { ref, onMounted, getCurrentInstance } from 'vue';
import { initializeDatabase, clearDatabase } from './composables/useDatabase';
import { initializeMap, disableLeafletKeyboardEvents } from './composables/useMap';
import { initializeOverlays, isEditMode, toggleEditMode } from './composables/useOverlay';
import { addOverlay, undo, redo } from './composables/useOverlayActions';
import { useToast } from './composables/useToast';
import { setAppContext } from './composables/useTools';

const toast = useToast();

const visible = ref(false);

onMounted(async () => {
  const app = getCurrentInstance();
  if (app) {
    setAppContext(app);
  }

  await initializeDatabase();
  await initializeMap();
  await initializeOverlays();

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'z') {
      undo();
    } else if (event.ctrlKey && event.key === 'y') {
      redo();
    }
  }, true);

  disableLeafletKeyboardEvents();
});

async function onImageUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    const imageUrl = reader.result as string;
    await addOverlay(imageUrl);
  };
  reader.readAsDataURL(file);
}
</script>

<style scoped>
.map-buttons {
  position: absolute;
  top: 80px;
  left: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
