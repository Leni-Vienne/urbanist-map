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
</script>
