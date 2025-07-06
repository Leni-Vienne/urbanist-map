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
      <!-- AI : Close button for mobile -->
      <div class="sidecolumn__header">
        <h3 class="sidecolumn__title">Moderation Panel</h3>
        <div class="header-actions">
          <Button
            icon="pi pi-undo"
            class="p-button-text p-button-rounded undo-button"
            @click="handleUndo"
            :disabled="!canUndo"
            v-tooltip.top="undoTooltip"
            aria-label="Undo last action"
          />
          <Button
            icon="pi pi-times"
            class="p-button-text p-button-rounded close-button"
            @click="$emit('close')"
            aria-label="Close panel"
          />
        </div>
      </div>
      
      <div class="sidelist">
        <DataView :value="overlays" v-if="overlays.length > 0">
          <template #list="slotProps">
            <div class="grid grid-nogutter">
              <div
                v-for="(item, index) in slotProps.items"
                :key="index"
                class="col-12"
              >
                <div
                  class="overlay-item"
                  :class="{ 'border-top-1 surface-border': index !== 0 }"
                >
                  <div class="overlay-content">
                    <div class="overlay-info">
                      <div class="overlay-name">
                        {{ item.name }}
                      </div>
                      <div class="overlay-city">
                        {{ item.city || 'Unknown' }}
                      </div>
                    </div>
                    <div class="overlay-actions">
                      <Button
                        icon="pi pi-check"
                        class="p-button-rounded p-button-success action-btn"
                        @click="approveOverlay(item.id)"
                        v-tooltip.top="'Approve'"
                      />
                      <Button
                        icon="pi pi-times"
                        class="p-button-rounded p-button-danger action-btn"
                        @click="rejectOverlay(item.id)"
                        v-tooltip.top="'Reject'"
                      />
                      <Button
                        icon="pi pi-map-marker"
                        class="p-button-rounded action-btn"
                        @click="navigateToOverlay(item.id)"
                        v-tooltip.top="'Navigate to overlay'"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </DataView>
        <div v-else class="p-4">
          No overlays to moderate.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useModeration } from '../../composables/overlay/useModeration'
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'
import DataView from 'primevue/dataview'
import Button from 'primevue/button'

defineProps<{
  isOpen: boolean
}>()

defineEmits<{
  close: []
}>()

const { overlays, recentActions, approveOverlay, rejectOverlay, undoLastAction } = useModeration()

// AI : Computed properties for undo functionality
const canUndo = computed(() => recentActions.value.length > 0)

const undoTooltip = computed(() => {
  if (recentActions.value.length === 0) {
    return 'No recent actions to undo'
  }
  const lastAction = recentActions.value[0]
  return `Undo ${lastAction.newStatus} action for "${lastAction.overlayName}"`
})

const handleUndo = async () => {
  const success = await undoLastAction()
  if (!success) {
    console.error('Failed to undo last action')
  }
}
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

.sidecolumn__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #dee2e6;
  background-color: #ffffff;
  flex-shrink: 0;
}

.sidecolumn__title {
  margin: 0;
  margin-left: 3.5rem; /* AI : Add space to avoid overlap with toggle button */
  font-size: 1.125rem;
  font-weight: 600;
  color: #374151;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.undo-button {
  color: #6366f1;
}

.undo-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.close-button {
  display: none;
}

.sidelist {
  flex: 1;
  overflow-y: auto;
}

/* AI : Overlay item styles for full width utilization */
.overlay-item {
  padding: 1rem;
  width: 100%;
}

.overlay-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 1rem;
}

.overlay-info {
  flex: 1;
  min-width: 0; /* AI : Allow text to truncate if needed */
}

.overlay-name {
  font-size: 1.125rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.25rem;
  word-wrap: break-word;
}

.overlay-city {
  font-size: 0.875rem;
  font-weight: 500;
  color: #6b7280;
}

.overlay-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.action-btn {
  width: 2.5rem;
  height: 2.5rem;
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
  
  .close-button {
    display: flex;
  }
  
  /* AI : Mobile-specific content optimizations */
  .overlay-item {
    padding: 1.25rem;
  }
  
  .overlay-content {
    gap: 1.5rem;
  }
  
  .overlay-name {
    font-size: 1.25rem;
  }
  
  .overlay-city {
    font-size: 1rem;
  }
  
  .action-btn {
    width: 3rem;
    height: 3rem;
  }
  
  .overlay-actions {
    gap: 0.75rem;
  }
}

/* AI : Tablet responsive styles */
@media (min-width: 769px) and (max-width: 1024px) {
  .sidecolumn {
    width: 400px;
  }
}
</style>
