<template>
  <div class="app-container">
    <MapSvgDefs />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
// AI : Leaflet CSS now loaded from CDN in index.html
import "leaflet-toolbar/dist/leaflet.toolbar.css";
import "leaflet-distortableimage/dist/leaflet.distortableimage.css";
import "./assets/style.css"; // Must be imported after leaflet's css otherwise it's overwritten by leaflet's default css
import "primeicons/primeicons.css";
import MapSvgDefs from "@/components/map/MapSvgDefs.vue";
import { watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { clearMapOnLogout } from "@/services/map/mapCleanup";

// AI : Watch for logout to clear map state
// AI : This decouples auth store from map logic logic
const authStore = useAuthStore();
watch(
  () => authStore.user,
  (newUser) => {
    if (!newUser) {
      clearMapOnLogout();
    }
  },
);
</script>
