<template>
  <div class="app-container">
    <SideMenu
      :is-open="sideMenuOpen"
      :is-moderator="isModerator"
      @close="handleSideMenuClose"
    />
    <div class="main-content">
      <button
        v-if="authStore.isAuthenticated"
        class="menu-toggle-button"
        @click="sideMenuOpen = !sideMenuOpen"
      >
        <i class="pi pi-bars" />
      </button>
      <Toast />

      <!-- AI : Map is always present in the background -->
      <MapView />


      <!-- AI : InfoPopup container using Teleport -->
      <InfoPopupContainer />
    </div>
  </div>
</template>

<script setup lang="ts">
// AI : Leaflet CSS now loaded from CDN in index.html
import 'leaflet-toolbar/dist/leaflet.toolbar.css'
import 'leaflet-distortableimage/dist/leaflet.distortableimage.css'
import './assets/style.css' // must be imported after leaflet's css otherwise it's overwritten by leaflet's default css
import 'primeicons/primeicons.css'

import { onMounted, ref, onUnmounted } from 'vue'
import MapView from '@components/map/MapView.vue'
import SideMenu from '@components/layout/SideMenu.vue'
import InfoPopupContainer from '@components/map/InfoPopupContainer.vue'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useAuthStore } from '@stores/authStore'
import { useToast } from '@composables/ui/useToast'
import { initializeStores } from '@composables/overlay/useOverlay'
import { useBeforeUnload } from '@composables/core/useBeforeUnload'

// AI : Create refs to track app state
const isModerator = ref(false)
const sideMenuOpen = ref(true) // AI : Open by default
const currentPanelType = ref<'explorer' | 'moderation'>('explorer') // AI : Default to explorer
const overlayStore = useOverlayStore()
const authStore = useAuthStore()
const toast = useToast()

// AI : Initialize beforeunload handler for modified overlays
useBeforeUnload()

// AI : Handle window blur to close UI elements gracefully
function handleWindowBlur() {
  // AI : Only close UI elements if the user actually leaves the application
  // AI : Don't close when opening dialogs within the same app
  setTimeout(() => {
    // AI : Check if focus returned to the window (meaning it was just a dialog opening)
    if (!document.hasFocus()) {
      overlayStore.closeAllUIElements();
    }
  }, 100);
}

// AI : Handle side menu close (mobile only)
function handleSideMenuClose() {
  sideMenuOpen.value = false;
}

onMounted(async () => {
  // AI : Initialize stores first
  initializeStores();

  if (import.meta.env.VITE_DEV_MODE === 'true') {
    isModerator.value = true
  }

  // AI : Add window blur listener to close UI elements gracefully
  window.addEventListener('blur', handleWindowBlur);

  try {
    // AI : Initialize Supabase authentication
    await authStore.initialize()
    
    // AI : Check if user is a moderator based on their role in Supabase
    if (authStore.user?.user_metadata?.role === 'admin') {
      isModerator.value = true
    }

    // AI : Handle auth query parameters from URL
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('auth') === 'success') {
      toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Successfully signed in!',
        life: 3000
      })
    } else if (urlParams.get('error')) {
      const errorMessage = getErrorMessage(urlParams.get('error') as string)
      toast.add({
        severity: 'error',
        summary: 'Authentication Error',
        detail: errorMessage,
        life: 5000
      })
    }
  }
  catch (error) {
    console.error('Error during application initialization:', error)
  }
})

// AI : Get user-friendly error messages
function getErrorMessage(error: string): string {
  switch (error) {
    case 'auth_failed':
      return 'Authentication failed. Please try again.'
    case 'no_session':
      return 'Sign in was cancelled or failed.'
    case 'unexpected':
      return 'An unexpected error occurred during sign in.'
    default:
      return 'Authentication error occurred.'
  }
}

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
