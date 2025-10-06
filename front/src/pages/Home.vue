<template>
  <div class="home-container">
    <!-- AI : Desktop SideMenu -->
    <SideMenu
      v-if="!isMobile"
      :is-open="desktopSideMenuOpen"
      :is-moderator="isModerator"
      @close="() => desktopSideMenuOpen = false"
    />

    <!-- AI : Mobile Bottom Drawer -->
    <MobileDrawer
      v-if="isMobile"
      v-model:visible="mobileSideMenuOpen"
    />

    <div class="main-content">
      <!-- AI : Mobile drawer handle - pull-up interface -->
      <div
        v-if="isMobile"
        v-show="!mobileSideMenuOpen && !uiStore.imageUploadDialogVisible && !uiStore.projectSelectorVisible"
        class="drawer-handle"
        @click="mobileSideMenuOpen = !mobileSideMenuOpen"
        role="button"
        tabindex="0"
        @keydown.enter="mobileSideMenuOpen = !mobileSideMenuOpen"
        @keydown.space.prevent="mobileSideMenuOpen = !mobileSideMenuOpen"
        :aria-label="mobileSideMenuOpen ? t('app.closePanel') : getToggleButtonText()"
        :aria-expanded="mobileSideMenuOpen"
      >
        <!-- AI : Visual handle indicator -->
        <div class="handle-indicator"></div>

        <!-- AI : Handle content -->
        <div class="handle-content">
          <span class="handle-text">
            {{ getToggleButtonText() }}
          </span>
        </div>
      </div>
      <Toast />

      <!-- AI : Map is always present in the background -->
      <MapView />

      <!-- AI : Popup container handles both overlay and project popups -->
      <PopupContainer v-if="overlayStore.showInfoPopup || uiStore.projectInfoPopup.visible" />
    </div>

    <!-- AI : Project Management Dialogs -->
    <ProjectManager v-if="uiStore.projectDialog.visible || uiStore.imageUploadDialogVisible || uiStore.projectSelectorVisible" />

    <!-- AI : Auth Modal for unauthenticated users -->
    <AuthModal v-model:visible="uiStore.authModalVisible" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, onUnmounted, computed, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import MapView from '@components/map/MapView.vue'
import SideMenu from '@components/layout/SideMenu.vue'
import AuthModal from '@components/auth/AuthModal.vue'
import MobileDrawer from '@components/layout/MobileDrawer.vue'

import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useAuthStore } from '@stores/authStore'
import { useUiStore } from '@stores/uiStore'
import { useToast } from '@composables/ui/useToast'
import { useBeforeUnload } from '@composables/core/useBeforeUnload'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'

const PopupContainer = defineAsyncComponent(() => import('@components/map/PopupContainer.vue'))
const ProjectManager = defineAsyncComponent(() => import('@components/project/ProjectManager.vue'))

// AI : Create refs to track app state
const isModerator = ref(false)
const desktopSideMenuOpen = ref(true) // AI : Open by default on desktop
const mobileSideMenuOpen = ref(true) // AI : Open by default on mobile
const overlayStore = useOverlayStore()
const authStore = useAuthStore()
const uiStore = useUiStore()
const toast = useToast()
const route = useRoute()
const { t } = useI18n()

// AI : Mobile detection for responsive drawer behavior
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)
const isMobile = computed(() => windowWidth.value <= 768)

// AI : Update window width on resize
function updateWindowWidth() {
  windowWidth.value = window.innerWidth

  // AI : Update mobile overflow constraints when window size changes
  if (isMobile.value) {
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.body.style.height = '100vh'
    document.body.style.height = '100dvh'
  } else {
    document.documentElement.style.overflow = ''
    document.body.style.overflow = ''
    document.body.style.height = ''
  }
}


// AI : Get the text for the mobile toggle button based on current drawer state
function getToggleButtonText(): string {
  if (!mobileSideMenuOpen.value) {
    // AI : When drawer is closed, show site name
    return t('app.title')
  }

  // AI : When drawer is open, show current active panel name from UI store
  const activeTab = uiStore.mobileDrawerActiveTab
  switch (activeTab) {
    case 'latest':
      return t('navigation.latest')
    case 'uploads':
      return t('navigation.myContributions')
    case 'admin':
      return t('navigation.admin')
    default:
      return t('app.title')
  }
}

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



onMounted(async () => {
  // AI : Add visibility change listener to close UI elements when user switches tabs/apps
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // AI : Add window resize listener for mobile detection
  window.addEventListener('resize', updateWindowWidth);


  // AI : Prevent page scrolling on mobile to avoid viewport issues
  if (isMobile.value) {
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.body.style.height = '100vh'
    document.body.style.height = '100dvh' // Use dynamic viewport where supported
  }


  // AI : Update overlayStore to use the new UI store for dialog control
  overlayStore.closeAllUIElements = uiStore.closeAllDialogs;

  try {
    await authStore.initialize()

    if (authStore.user?.role === 'admin') {
      isModerator.value = true
    }

    // AI : Handle auth query parameters from URL
    if (route.query.auth === 'success') {
      toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Successfully signed in!',
        life: 3000
      })
    } else if (route.query.error) {
      const errorMessage = getErrorMessage(route.query.error as string)
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
  window.removeEventListener('resize', updateWindowWidth);

  // AI : Restore normal overflow behavior when component unmounts
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
  document.body.style.height = ''
})
</script>

<style scoped>
.home-container {
  display: flex;
  height: 100vh;
}

.main-content {
  flex-grow: 1;
  position: relative;
}

.drawer-handle {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1005;
  background: var(--p-surface-0);
  border-top-left-radius: 1.5rem;
  border-top-right-radius: 1.5rem;
  height: 4rem;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  box-shadow:
    0 -4px 16px rgba(0, 0, 0, 0.1),
    0 -2px 8px rgba(0, 0, 0, 0.05);
  transition: transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1), box-shadow 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
  border-top: 1px solid var(--p-surface-100);

  /* AI : Prevent layout shifts during Chrome viewport changes */
  contain: layout style paint;
  will-change: transform;

  /* AI : Ensure proper positioning on mobile browsers */
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
}

.drawer-handle:hover {
  transform: translateZ(0) translateY(-2px);
  box-shadow:
    0 -6px 20px rgba(0, 0, 0, 0.15),
    0 -4px 12px rgba(0, 0, 0, 0.08);
}

.drawer-handle:active {
  transform: translateZ(0) translateY(-1px);
}

.handle-indicator {
  width: 2.5rem;
  height: 0.25rem;
  background: var(--p-surface-300);
  border-radius: 0.125rem;
  margin: 0.75rem auto 0;
  transition: background-color 0.2s ease;
}

.drawer-handle:hover .handle-indicator {
  background: var(--p-surface-400);
}

.handle-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 1.5rem;
}

.handle-text {
  font-size: 1rem;
  font-weight: 500;
  color: var(--p-text-color);
  text-align: center;
}
</style>