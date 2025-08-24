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

      <!-- AI : InfoPopup with teleport mechanism -->
      <InfoPopupContainer />
    </div>

    <!-- AI : Project Management Dialogs -->
    <ProjectManager />

    <!-- AI : Auth Modal for unauthenticated users -->
    <AuthModal v-model:visible="uiStore.authModalVisible" />
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
import ProjectManager from '@components/project/ProjectManager.vue'
import AuthModal from '@components/auth/AuthModal.vue'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useAuthStore } from '@stores/authStore'
import { useUiStore } from '@stores/uiStore'
import { useToast } from '@composables/ui/useToast'
import { initializeStores } from '@composables/overlay/useOverlay'
import { useBeforeUnload } from '@composables/core/useBeforeUnload'
import { storeToRefs } from 'pinia'

// AI : Create refs to track app state
const isModerator = ref(false)
const sideMenuOpen = ref(true) // AI : Open by default
const currentPanelType = ref<'explorer' | 'moderation'>('explorer') // AI : Default to explorer
const overlayStore = useOverlayStore()
const authStore = useAuthStore()
const uiStore = useUiStore()
const toast = useToast()

const { pendingImageFile } = storeToRefs(overlayStore)

// AI : Initialize beforeunload handler for modified overlays
useBeforeUnload()

// AI : Handle window visibility change to close UI elements when user switches tabs/apps
function handleVisibilityChange() {
  // AI : Only close dialogs when the page becomes hidden (user switched tabs/minimized window)
  // AI : This is more reliable than blur events and doesn't interfere with native dialogs
  if (document.hidden) {
    // AI : Don't close if we're in the middle of critical user flows
    if (!pendingImageFile.value && !uiStore.imageUploadDialogVisible && !uiStore.projectSelectorVisible) {
      overlayStore.closeAllUIElements();
    }
  }
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

  // AI : Add visibility change listener to close UI elements when user switches tabs/apps
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // AI : Update overlayStore to use the new UI store for dialog control
  overlayStore.closeAllUIElements = uiStore.closeAllDialogs;

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
  document.removeEventListener('visibilitychange', handleVisibilityChange);
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
