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
    <div class="sidecolumn__content">
      <!-- AI : Dynamic content based on current panel -->
      <component 
        :is="currentPanel" 
        @close="$emit('close')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue'

// AI : Lazy load ModerationPanel to reduce initial bundle size
const ModerationPanel = defineAsyncComponent(() => import('./ModerationPanel.vue'))

const props = defineProps<{
  isOpen: boolean
  panel?: string
}>()

defineEmits<{
  close: []
}>()

// AI : Map of available panels
const panels: Record<string, Component> = {
  moderation: ModerationPanel,
  // AI : Add more panels here as needed
}

// AI : Default to moderation panel if no panel specified
const currentPanel = computed(() => {
  return panels[props.panel ?? 'moderation'] ?? ModerationPanel
})
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

.sidecolumn__content {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* AI : Mobile responsive styles */
@media (max-width: 768px) {
  .mobile-backdrop {
    display: block;
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
