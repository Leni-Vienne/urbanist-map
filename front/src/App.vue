<template>
  <div class="app-container">
    <SideMenu
      v-if="isModerator"
      :is-open="moderationPanelOpen"
      panel="moderation"
      @close="moderationPanelOpen = false"
    />
    <div class="main-content">
      <button
        v-if="isModerator"
        class="moderation-toggle-button"
        @click="moderationPanelOpen = !moderationPanelOpen"
      >
        <i class="pi pi-bars" />
      </button>
      <Toast />

      <!-- AI : Map is always present in the background -->
      <MapView />

      <!-- AI : Router view as overlay on top of the map -->
      <router-view />

      <!-- AI : Teleport target for InfoPopup -->
      <div id="info-popup-teleport-target" />

      <!-- AI : InfoPopup container using Teleport -->
      <InfoPopupContainer />
    </div>
  </div>
</template>

<script setup lang="ts">
import 'leaflet/dist/leaflet.css'
import 'leaflet-toolbar/dist/leaflet.toolbar.css'
import 'leaflet-distortableimage/dist/leaflet.distortableimage.css'
import './assets/style.css' // must be imported after leaflet's css otherwise it's overwritten by leaflet's default css
import 'primeicons/primeicons.css'

import { onMounted, provide, ref, getCurrentInstance, onUnmounted } from 'vue'
import MapView from '@components/map/MapView.vue'
import SideMenu from '@components/layout/SideMenu.vue'
import InfoPopupContainer from '@components/map/InfoPopupContainer.vue'
import { useOverlayStore } from '@stores/pinia/overlayStore'

// AI : Create a ref to track database initialization state
const isModerator = ref(false)
const moderationPanelOpen = ref(false)
const overlayStore = useOverlayStore()

// AI : Provide the initialization state to child components

// AI : Handle window blur to close UI elements gracefully
function handleWindowBlur() {
  overlayStore.closeAllUIElements();
  moderationPanelOpen.value = false;
}

onMounted(async () => {
  if (import.meta.env.VITE_DEV_MODE === 'true') {
    isModerator.value = true
  }

  // AI : Add window blur listener to close UI elements gracefully
  window.addEventListener('blur', handleWindowBlur);

  try {
    // AI : Use environment variable for API base URL
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/check-session`, {
      method: 'GET',
      credentials: 'include',
    })

    if (response.ok) {
      const user = await response.json()
      if (user.role === 'admin')
        isModerator.value = true
    }
  }
  catch (error) {
    console.error('Error during application initialization:', error)
  }
})

onUnmounted(() => {
  window.removeEventListener('blur', handleWindowBlur);
})
</script>

<style>
.app-container {
  display: flex;
  height: 100vh;
}

.main-content {
  flex-grow: 1;
  position: relative;
}

/* AI : Transition effects for route changes */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.moderation-toggle-button {
  position: fixed;
  top: 1rem;
  left: 1rem;
  z-index: 1001;
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 0.25rem;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
}

.moderation-toggle-button:hover {
  background-color: #e9ecef;
  transform: scale(1.05);
}
</style>
