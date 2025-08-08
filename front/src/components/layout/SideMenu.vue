<template>
  <!-- AI : Mobile backdrop overlay -->
  <div
    v-if="isOpen"
    class="mobile-backdrop"
    @click="$emit('close')"
  ></div>

  <div
    class="sidecolumn"
    :class="{ 'sidecolumn--collapsed': !isOpen }"
  >
    <!-- AI : Common header for all panels -->
    <div class="sidecolumn__header">
      <h2 class="site-title">ConstructionMap.org</h2>
      <div class="header-actions">
        <Button
          icon="pi pi-times"
          class="p-button-text p-button-rounded close-button"
          @click="$emit('close')"
          aria-label="Close panel"
        />
      </div>
    </div>

    <!-- AI : Tab navigation like the prototype -->
    <div class="tab-navigation">
      <button
        :class="['tab-button', { active: activeTab === 'latest' }]"
        @click="activeTab = 'latest'"
      >
        Latest
      </button>
      <button
        :class="['tab-button', { active: activeTab === 'uploads' }]"
        @click="activeTab = 'uploads'"
      >
        My Uploads
      </button>
      <button
        v-if="isModerator"
        :class="['tab-button', { active: activeTab === 'admin' }]"
        @click="activeTab = 'admin'"
      >
        Admin
      </button>
    </div>

    <div class="sidecolumn__content">
      <!-- AI : Tab content based on active tab -->
      <LatestOverlaysPanel v-if="activeTab === 'latest'" />
      <MyUploadsPanel v-else-if="activeTab === 'uploads'" />
      <ModerationPanel v-else-if="activeTab === 'admin'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue'
import Button from 'primevue/button'

// AI : Lazy load panels to reduce initial bundle size
const ModerationPanel = defineAsyncComponent(() => import('./ModerationPanel.vue'))
const LatestOverlaysPanel = defineAsyncComponent(() => import('./LatestOverlaysPanel.vue'))
const MyUploadsPanel = defineAsyncComponent(() => import('./MyUploadsPanel.vue'))

const props = defineProps<{
  isOpen: boolean
  isModerator?: boolean
}>()

defineEmits<{
  close: []
}>()

// AI : Tab state - default to "latest" like the prototype
const activeTab = ref<'latest' | 'uploads' | 'admin'>('latest')
</script>

<style scoped>
/* AI : Mobile backdrop for overlay */
.mobile-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 999;
  display: none;
}

.sidecolumn {
  position: relative;
  flex-shrink: 0;
  width: 380px;
  height: 100%;
  background-color: var(--p-surface-0);
  border-right: 1px solid var(--p-surface-200);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
  transition: all 300ms ease-in-out;
  overflow: hidden;
  z-index: 1000;
}

.sidecolumn--collapsed {
  width: 0;
  border-right: none;
}

.sidecolumn__header {
  flex-shrink: 0;
  padding: 2rem 1.5rem 1.5rem;
  background-color: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-100);
  position: relative;
}

.site-title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.025em;
  color: var(--p-surface-800);
}

/* AI : Tab navigation styles */
.tab-navigation {
  display: flex;
  margin: 0 1.5rem;
  background-color: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-100);
}

.tab-button {
  flex: 1;
  padding: 1rem 0;
  border: none;
  background: transparent;
  font-weight: 500;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 150ms ease-out;
  text-align: center;
  border-bottom: 2px solid transparent;
  color: var(--p-surface-500);
}

.tab-button:hover {
  color: var(--p-surface-600);
  background-color: var(--p-surface-50);
}

.tab-button.active {
  font-weight: 600;
  color: var(--p-primary-600);
  background-color: var(--p-surface-0);
  border-bottom-color: var(--p-primary-600);
}

.header-actions {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.panel-toggle-button {
  color: var(--p-primary-600);
}

.close-button {
  display: none;
  /* AI : Hidden on desktop by default */
  color: var(--p-surface-500);
}

.sidecolumn__content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* AI : Mobile responsive styles */
@media (max-width: 768px) {
  .mobile-backdrop {
    display: block;
  }

  .close-button {
    display: flex;
    /* AI : Show close button on mobile */
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
    width: 100%;
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
    width: 100%;
    transform: translateX(-100%);
  }
}

/* AI : Tablet responsive styles */
@media (min-width: 769px) and (max-width: 1024px) {
  .sidecolumn {
    width: 500px;
  }
}
</style>
