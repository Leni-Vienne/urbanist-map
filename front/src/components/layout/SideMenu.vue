<template>
  <div
    class="sidecolumn"
    :class="{ 'sidecolumn--collapsed': !isOpen }"
  >
    <!-- AI : Common header for all panels -->
    <div class="sidecolumn__header">
      <h2 class="site-title">{{ $t('app.title') }}</h2>
      <div class="header-actions">
        <Button
          icon="pi pi-times"
          class="p-button-text p-button-rounded close-button"
          @click="$emit('close')"
          :aria-label="$t('app.closePanel')"
        />
      </div>
    </div>

    <!-- AI : Shared panel content with tabs -->
    <PanelContent
      v-model:active-tab="activeTab"
      tab-container-class="tab-navigation"
      tab-button-class="tab-button"
      content-container-class="sidecolumn__content"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import PanelContent from './PanelContent.vue'
import { usePanelTabs } from '@composables/layout/usePanelTabs'

defineProps<{
  isOpen: boolean
  isModerator?: boolean
}>()

defineEmits<{
  close: []
}>()

// AI : Tab state - default to "latest"
const activeTab = ref<'latest' | 'uploads' | 'moderation'>('latest')

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
  flex-shrink: 0;
  padding: 2rem 1.5rem 1.5rem;
  background-color: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-100);
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

.sidecolumn__content {
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

  .sidecolumn__header {
    padding: 1rem;
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
</style>
