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
import "leaflet-distortableimage/dist/leaflet.distortableimage.css";
import './assets/style.css' // must be imported after leaflet's css otherwise it's overwritten by leaflet's default css
import 'primeicons/primeicons.css'

import { onMounted, provide, ref, getCurrentInstance } from 'vue';
import { initializeDatabase } from '@composables/core/useDatabase';
import MapView from '@components/map/MapView.vue';
import { setAppContext } from '@composables/core/useTools';
import { trpc } from '@client';

// AI : Create a ref to track database initialization state
const databaseInitialized = ref(false);

// AI : Provide the initialization state to child components
provide('databaseInitialized', databaseInitialized);

onMounted(async () => {
  try {
    // AI : Store app instance context for dynamic components
    const instance = getCurrentInstance();
    if (instance) {
      //setAppContext(instance);
    } else {
      console.warn('Unable to get current instance in App.vue');
    }

    // AI : Initialize global services that should be available app-wide
    await initializeDatabase();
    // AI : Projects are now loaded lazily when entering edit mode or uploading overlays

    // AI : Set initialization flag to true after both operations complete
    databaseInitialized.value = true;

    // Utiliser un appel à l'API pour vérifier le statut d'authentification
    const response = await fetch('http://localhost:3000/api/check-session', {
      method: 'GET',
      credentials: 'include'
    })

    if (response.ok) {
      const data = await response.json()
    }
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
