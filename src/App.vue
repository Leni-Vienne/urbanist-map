<template>
  <Toast />
  
  <!-- AI : Map is always present in the background -->
  <MapView />
  
  <!-- AI : Router view as overlay on top of the map -->
  <router-view />
</template>

<script setup lang="ts">
import 'leaflet/dist/leaflet.css';
import 'leaflet-toolbar/dist/leaflet.toolbar.css';
import "leaflet-distortableimage-updated/dist/leaflet.distortableimage.css";
import './assets/style.css' // must be imported after leaflet's css otherwise it's overwritten by leaflet's default css
import 'primeicons/primeicons.css'

import { onMounted, provide, ref } from 'vue';
import { initializeDatabase } from './composables/useDatabase';
import { initializeProjects } from './composables/useProjects';
import MapView from './components/MapView.vue';

// AI : Create a ref to track database initialization state
const databaseInitialized = ref(false);

// AI : Provide the initialization state to child components
provide('databaseInitialized', databaseInitialized);

onMounted(async () => {
  try {
    // AI : Initialize global services that should be available app-wide
    console.log('Starting database initialization...');
    await initializeDatabase();
    console.log('Database initialized successfully');
    
    console.log('Starting projects initialization...');
    await initializeProjects();
    console.log('Projects initialized successfully');
    
    // AI : Set initialization flag to true after both operations complete
    databaseInitialized.value = true;
    console.log('Application initialization complete');
  } catch (error) {
    console.error('Error during application initialization:', error);
  }
});
</script>

<style>
/* AI : Transition effects for route changes */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
