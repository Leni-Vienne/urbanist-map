<template>
  <div class="sidecolumn" :class="{ 'sidecolumn--collapsed': !isOpen }">
    <!-- AI : Fixed header containing title, close button, and navigation tabs -->
    <div class="sidecolumn__header">
      <div class="header-top">
        <div class="title-container">
          <h2 class="site-title">{{ $t('app.title') }}</h2>
          <p class="site-subtitle">{{ $t('app.subtitle') }}</p>
        </div>

        <div class="header-actions">
          <Button
            icon="pi pi-times"
            class="p-button-text p-button-rounded close-button"
            @click="$emit('close')"
            :aria-label="$t('app.closePanel')"
          />
        </div>
      </div>

      <!-- AI : Tab navigation inside fixed header -->
      <PanelTabs
        v-model:active-tab="activeTab"
        tab-container-class="tab-navigation"
        tab-button-class="tab-button"
      />
    </div>

    <!-- AI : Scrollable content area -->
    <PanelContent :active-tab="activeTab" content-container-class="sidecolumn__content" />

    <!-- AI : Footer with legal links -->
    <div class="sidecolumn__footer">
      <a href="/legal" class="footer-link">{{ $t("footer.legalMentions") }}</a>
      <span class="footer-separator">•</span>
      <a href="/contact" class="footer-link">{{ $t("footer.contact") }}</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import PanelContent from './PanelContent.vue'
import PanelTabs from './PanelTabs.vue'
import { usePanelTabs } from '@/composables/layout/usePanelTabs'
import { useMapStore } from '@/stores/pinia/mapStore'
import { useUiStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import type { PanelTab } from '@/types'

defineProps<{
  isOpen: boolean
  isModerator?: boolean
}>()

defineEmits<{
  close: []
}>()

// AI : Local tab state
const activeTab = ref<PanelTab>('latest')

// AI : Get stores
const mapStore = useMapStore()
const uiStore = useUiStore()
const authStore = useAuthStore()

// AI : Watch for authentication changes and execute post-login callback
watch(() => authStore.isAuthenticated, (isAuthenticated) => {
  if (isAuthenticated && uiStore.postLoginCallback) {
    // AI : User just logged in, execute the callback
    uiStore.executePostLoginCallback()
  }
})

// AI : Watch for city changes and auto-switch tabs based on city state
// AI : This makes standalone projects behave like overlays when clicked from latest contributions
// AI : AND ensures we don't stay on Current City tab when there's no city selected
let previousCityId = mapStore.selectedCity?.id
watch(() => mapStore.selectedCity, (newCity) => {
  // AI : Case 1: City was selected (either new or changed from another city)
  // AI : Switch to Current City tab only if coming from Latest tab
  if (newCity && newCity.id !== previousCityId && activeTab.value === 'latest') {
    activeTab.value = 'currentCity'
  }

  // AI : Case 2: City was cleared (e.g., by clicking a country marker)
  // AI : Switch away from Current City tab to avoid showing empty state
  if (!newCity && previousCityId && activeTab.value === 'currentCity') {
    activeTab.value = 'latest'
  }

  previousCityId = newCity?.id
})

// AI : Initialize shared tab logic (mode syncing, authentication watchers)
usePanelTabs(activeTab)
</script>

<style scoped>
.sidecolumn {
  /* to make the accordion header highlight on hover */
  --p-accordion-header-hover-background: var(--p-surface-100);
  --p-accordion-header-active-hover-background: var(--p-surface-100);

  position: relative;
  flex-shrink: 0;
  width: 380px;
  height: 100vh;
  max-height: 100vh;
  background-color: var(--p-surface-0);
  border-right: 1px solid var(--p-surface-200);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
  transition: all 300ms ease-in-out;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}


.sidecolumn--collapsed {
  width: 0;
  border-right: none;
  overflow: hidden;
}

.sidecolumn__header {
  position: sticky;
  top: 0;
  z-index: 10;
  flex-shrink: 0;
  background-color: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-100);
}

.header-top {
  padding: 0.5rem 1.5rem 0.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}


.site-title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.025em;
  color: var(--p-surface-800);
}

.site-subtitle {
  margin: 0.25rem 0 0 0;
  font-size: 0.875rem;
  color: var(--p-surface-500);
  line-height: 1.4;
}

.header-actions {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.close-button {
  display: none;
  color: var(--p-surface-500);
}

/* AI : Deep selector to apply overflow to content container passed to PanelContent */
:deep(.sidecolumn__content) {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  scrollbar-gutter: stable;
}


/* AI : Mobile responsive styles */
@media (max-width: 768px) {

  .close-button {
    display: flex;
  }

  .site-title {
    font-size: 1.375rem;
  }

  .sidecolumn {
    position: fixed;
    top: 0;
    left: 0;
    width: 85%;
    max-width: 380px;
    height: 100vh;
    transform: translateX(-100%);
    transition: transform 0.3s ease-in-out;
    border-right: none;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
  }

  .sidecolumn:not(.sidecolumn--collapsed) {
    transform: translateX(0);
  }

  .sidecolumn--collapsed {
    width: 85%;
    max-width: 380px;
    transform: translateX(-100%);
  }
}

/* AI : Footer with legal links */
.sidecolumn__footer {
  flex-shrink: 0;
  padding: 0.5rem;
  background: var(--p-surface-50);
  border-top: 1px solid var(--p-surface-100);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
}

.footer-link {
  color: var(--p-surface-600);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: var(--p-surface-400);
  font-size: 0.75rem;
  transition: all 0.15s ease;
}

.footer-link:hover {
  color: var(--p-primary-600);
  text-decoration-color: var(--p-primary-600);
}

.footer-separator {
  color: var(--p-surface-400);
  font-size: 0.75rem;
}
</style>
