<template>
  <div class="app-container">
    <SideMenu
      :is-open="sideMenuOpen"
      :is-moderator="isModerator"
      @close="handleSideMenuClose"
    />
    <div class="main-content">
      <button
        class="menu-toggle-button"
        @click="sideMenuOpen = !sideMenuOpen"
      >
        <i class="pi pi-bars" />
      </button>
      <Toast />

      <!-- AI : Map is always present in the background -->
      <MapView />

      <!-- AI : Router view as overlay on top of the map -->
      <router-view />

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

import { onMounted, ref, onUnmounted, computed } from 'vue'
import MapView from '@components/map/MapView.vue'
import SideMenu from '@components/layout/SideMenu.vue'
import InfoPopupContainer from '@components/map/InfoPopupContainer.vue'
import { useOverlayStore } from '@stores/pinia/overlayStore'

// AI : Create refs to track app state
const isModerator = ref(false)
const sideMenuOpen = ref(true) // AI : Open by default
const currentPanelType = ref<'explorer' | 'moderation'>('explorer') // AI : Default to explorer
const overlayStore = useOverlayStore()

// AI : Determine which panel to show - allow manual override
const currentPanel = computed(() => {
  return currentPanelType.value
})

// AI : Provide the initialization state to child components

// AI : Handle window blur to close UI elements gracefully
function handleWindowBlur() {
  overlayStore.closeAllUIElements();
}

// AI : Handle side menu close (mobile only)
function handleSideMenuClose() {
  sideMenuOpen.value = false;
}

// AI : Toggle between explorer and moderation panels
function togglePanel() {
  if (isModerator.value) {
    currentPanelType.value = currentPanelType.value === 'explorer' ? 'moderation' : 'explorer'
  }
}

onMounted(async () => {
  if (import.meta.env.VITE_DEV_MODE === 'true') {
    isModerator.value = true
  }

  // AI : Add window blur listener to close UI elements gracefully
  window.addEventListener('blur', handleWindowBlur);

  try {
    // AI : Use environment variable for API base URL
    const response = await fetch(`/api/check-session`, {
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

.menu-toggle-button {
  position: fixed;
  top: 10px;
  left: 10px;
  z-index: 1001;
  background-color: var(--p-surface-50);
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

.menu-toggle-button:hover {
  background-color: var(--p-surface-100);
  transform: scale(1.05);
}

/* AI : Hide toggle button on desktop when side menu is open */
@media (min-width: 769px) {
  .menu-toggle-button {
    display: none;
  }
}

/* AI : Show toggle button on mobile */
@media (max-width: 768px) {
  .menu-toggle-button {
    display: flex;
  }
}
</style>
