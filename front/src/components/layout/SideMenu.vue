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
      <div class="site-branding">
        <h2 class="site-title">Construction Map</h2>
      </div>
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
  width: 300px;
  height: 100%;
  background-color: #f8f9fa;
  border-right: 1px solid #dee2e6;
  transition: width 0.3s ease-in-out;
  overflow: hidden;
  z-index: 1000;
}

.sidecolumn--collapsed {
  width: 0;
  border-right: none;
}

.sidecolumn__header {
  flex-shrink: 0;
  padding: 1.5rem 1rem 1rem;
  border-bottom: 1px solid #e5e7eb;
  background-color: #ffffff;
  position: relative;
}

.site-branding {
  margin-bottom: 0.5rem;
  padding-right: 3rem; /* AI : Space for header actions */
}

.site-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: #111827;
  line-height: 1.2;
}

/* AI : Tab navigation styles */
.tab-navigation {
  display: flex;
  border-bottom: 1px solid #e5e7eb;
  background-color: #ffffff;
}

.tab-button {
  flex: 1;
  padding: 0.75rem 1rem;
  border: none;
  background: none;
  color: #6b7280;
  font-weight: 500;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
  border-bottom: 2px solid transparent;
}

.tab-button:hover {
  color: #374151;
  background-color: #f9fafb;
}

.tab-button.active {
  color: #6366f1;
  border-bottom-color: #6366f1;
  background-color: #ffffff;
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
  color: #6366f1;
}

.close-button {
  color: #6b7280;
  display: none; /* AI : Hidden on desktop by default */
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
    display: flex; /* AI : Show close button on mobile */
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
    width: 400px;
  }
}
</style>
