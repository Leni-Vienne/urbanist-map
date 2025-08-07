<template>
  <div class="moderation-panel">
    <!-- AI : Panel-specific header with just the actions -->
    <div class="moderation-panel__subheader">
      <h3 class="moderation-panel__title">Pending Overlays</h3>
      <div class="subheader-actions">
        <Button
          icon="pi pi-undo"
          class="p-button-text p-button-rounded undo-button"
          @click="handleUndo"
          :disabled="!canUndo"
          v-tooltip.top="undoTooltip"
          aria-label="Undo last action"
        />
      </div>
    </div>
    
    <div class="moderation-content">
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
                      {{ item.city ?? 'Unknown' }}
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
                      @click="() => navigateToOverlay(item.id)"
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
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useModeration } from '../../composables/overlay/useModeration'
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'
import DataView from 'primevue/dataview'
import Button from 'primevue/button'

defineEmits<{
  close: []
  togglePanel: []
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
.moderation-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.moderation-panel__subheader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #dee2e6;
  background-color: #ffffff;
  flex-shrink: 0;
}

.moderation-panel__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: #374151;
}

.subheader-actions {
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


.moderation-content {
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
</style>
