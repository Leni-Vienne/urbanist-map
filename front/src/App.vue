<template>
  <div class="app-container">
    <RouterView />
  </div>
</template>

<script setup lang="ts">
// AI : Leaflet CSS now loaded from CDN in index.html
import 'leaflet-toolbar/dist/leaflet.toolbar.css'
import 'leaflet-distortableimage/dist/leaflet.distortableimage.css'
import './assets/style.css' // must be imported after leaflet's css otherwise it's overwritten by leaflet's default css
import 'primeicons/primeicons.css'
</script>

<style>
.app-container {
  height: 100vh;
}

/* AI : Transition effects for route changes */
.router-fade-enter-active,
.router-fade-leave-active {
  transition: opacity 0.3s ease;
}

.router-fade-enter-from,
.router-fade-leave-to {
  opacity: 0;
}
</style>
