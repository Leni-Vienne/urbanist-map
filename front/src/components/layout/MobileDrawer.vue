<template>
  <!-- AI : Mobile Bottom Drawer - PrimeVue Implementation -->
  <Drawer
    v-model:visible="isVisible"
    position="bottom"
    :modal="false"
    header="ConstructionMap.org"
    :dismissable="false"
    :show-close-icon="true"
    class="!h-[40vh] !rounded-t-2xl"
  >
    
    <div class="drawer-tabs">
      <button
        :class="['drawer-tab', { active: activeTab === 'latest' }]"
        @click="activeTab = 'latest'"
      >
        {{ $t('navigation.latestContributions') }}
      </button>
      <button
        v-if="authStore.isAuthenticated"
        :class="['drawer-tab', { active: activeTab === 'uploads' }]"
        @click="activeTab = 'uploads'"
      >
        {{ $t('navigation.myContributions') }}
      </button>
      <button
        v-if="authStore.isAdmin"
        :class="['drawer-tab', { active: activeTab === 'admin' }]"
        @click="activeTab = 'admin'"
      >
        {{ $t('navigation.admin') }}
      </button>
    </div>

    <div class="drawer-content">
      <!-- AI : Show content based on active tab -->
      <LatestOverlaysPanel v-if="activeTab === 'latest'" />
      <MyContributionsPanel v-else-if="activeTab === 'uploads' && authStore.isAuthenticated" />
      <ModerationPanel v-else-if="activeTab === 'admin' && authStore.isAdmin" />

      <!-- AI : Show sign-in prompt for authenticated tabs when not signed in -->
      <div
        v-else-if="(!authStore.isAuthenticated && (activeTab === 'uploads' || activeTab === 'admin')) || (activeTab === 'admin' && !authStore.isAdmin)"
        class="signin-prompt"
      >
        <div class="signin-content">
          <i class="pi pi-user text-4xl text-muted-color mb-4"></i>
          <h3 class="text-lg font-semibold mb-2">
            {{ activeTab === 'admin' && authStore.isAuthenticated && !authStore.isAdmin ? $t('auth.adminAccessRequired') : $t('auth.authenticationRequired') }}
          </h3>
          <p class="text-muted-color text-sm mb-4 text-center">
            {{ activeTab === 'admin' && authStore.isAuthenticated && !authStore.isAdmin 
              ? $t('auth.adminMessage')
              : $t('auth.signInMessage') }}
          </p>
        </div>
      </div>
    </div>
    
    <!-- AI : Footer with legal links -->
    <div class="drawer-footer">
      <a href="/legal" class="footer-link">{{ $t('footer.legalMentions') }}</a>
      <span class="footer-separator">•</span>
      <a href="/contact" class="footer-link">{{ $t('footer.contact') }}</a>
    </div>
  </Drawer>
</template>

<script setup lang="ts">
import { defineAsyncComponent, watch, computed } from 'vue'
import LatestOverlaysPanel from './LatestOverlaysPanel.vue' // AI : static import since it's the default panel
import { useAuthStore } from '@stores/authStore'
import { useUiStore } from '@stores/uiStore'

// AI : Lazy load panels to reduce initial bundle size
const ModerationPanel = defineAsyncComponent(() => import('./ModerationPanel.vue'))
const MyContributionsPanel = defineAsyncComponent(() => import('./MyContributionsPanel.vue'))

const authStore = useAuthStore()
const uiStore = useUiStore()

const isVisible = defineModel<boolean>('visible', { default: false })

// AI : Use UI store for active tab state (shared with Home component)
const activeTab = computed({
  get: () => uiStore.mobileDrawerActiveTab,
  set: (value) => uiStore.setMobileDrawerActiveTab(value)
})

// AI : Watch for authentication changes and reset tab if user signs out or loses admin rights
watch(() => authStore.isAuthenticated, (isAuthenticated) => {
  if (!isAuthenticated && (activeTab.value === 'uploads' || activeTab.value === 'admin')) {
    activeTab.value = 'latest'
  }
})

// AI : Watch for admin role changes and reset admin tab if user loses admin rights
watch(() => authStore.isAdmin, (isAdmin) => {
  if (!isAdmin && activeTab.value === 'admin') {
    activeTab.value = 'latest'
  }
})
</script>

<style scoped>
/* AI : PrimeVue Mobile Drawer */
:deep(.p-drawer-mask.p-drawer-bottom) {
  /* AI : Prevent drawer from being dragged below screen bottom */
  max-height: 100vh;
  overflow: hidden;
}

:deep(.p-drawer.p-drawer-bottom) {
  /* AI : Constrain drawer to bottom edge - prevent over-dragging */
  bottom: 0 !important;
  min-height: auto !important;
  max-height: 100vh !important;
  max-height: 100dvh !important; /* AI : Use dynamic viewport height where supported */
  /* AI : Prevent any transform that would move it below bottom */
  transform: translateY(0) !important;
  /* AI : Disable touch-based dragging to prevent over-scroll */
  touch-action: pan-x pan-y pinch-zoom;
}

/* AI : Additional constraints to prevent drawer positioning issues */
:deep(.p-drawer-mask.p-drawer-bottom .p-drawer) {
  position: fixed !important;
  bottom: 0 !important;
  top: auto !important;
}

:deep(.mobile-drawer .p-drawer-content) {
  padding: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.drawer-tabs {
  display: flex;
  background-color: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-100);
  flex-shrink: 0;
}

.drawer-tab {
  flex: 1;
  padding: 0.75rem 0;
  border: none;
  background: transparent;
  font-weight: 500;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 150ms ease-out;
  text-align: center;
  border-bottom: 2px solid transparent;
  color: var(--p-surface-600);
}

.drawer-tab:hover {
  color: var(--p-surface-700);
  background-color: var(--p-surface-50);
}

.drawer-tab.active {
  font-weight: 600;
  color: var(--p-primary-600);
  border-bottom-color: var(--p-primary-600);
}

.drawer-content {
  flex: 1;
  overflow-y: auto;
  background-color: var(--p-surface-0);
  padding-bottom: 3rem; /* AI : Account for footer height */
}

.signin-prompt {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 2rem;
}

.signin-content {
  text-align: center;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.drawer-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0.2rem 1rem;
  background: var(--p-surface-50);
  border-top: 1px solid var(--p-surface-100);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  z-index: 10;
}

.footer-link {
  color: var(--p-surface-600);
  text-decoration: none;
  font-size: 0.65rem;
  transition: color 0.2s ease;
}

.footer-link:hover {
  color: var(--p-primary-600);
  text-decoration: underline;
}

.footer-separator {
  color: var(--p-surface-400);
  font-size: 0.65rem;
}
</style>