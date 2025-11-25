<template>
  <!-- AI : Floating bar for marker placement -->
  <div 
    v-if="markerPlacementMode && visible" 
    class="marker-placement-bar"
  >
    <div class="placement-content">
      <i class="pi pi-map-marker placement-icon"></i>
      <div class="placement-text">
        <span v-if="!markerCoordinates" class="instruction">{{ $t('project.clickMapToPlace') }}</span>
        <span v-else class="coordinates-text">{{ markerCoordinates.lat.toFixed(5) }}, {{ markerCoordinates.lng.toFixed(5) }}</span>
      </div>
    </div>
    <div class="placement-actions">
      <Button 
        v-if="markerCoordinates"
        :label="$t('common.continue')"
        size="small"
        @click="onContinue"
      />
      <Button 
        :label="$t('common.cancel')"
        severity="secondary"
        size="small"
        @click="onCancel"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useOverlayStore } from '@stores/pinia/overlayStore';

// AI : Component props and emits
interface Props {
  visible: boolean;
}

interface Emits {
  (e: 'update:visible', value: boolean): void;
  (e: 'marker-coordinates', coordinates: { lat: number; lng: number }): void;
  (e: 'marker-mode-enabled'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// AI : Component state
const markerCoordinates = ref<{ lat: number; lng: number } | null>(null);
const markerPlacementMode = ref(false);

// AI : Handle visibility changes
const visible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
});

// AI : Auto-enable marker placement when dialog opens
watch(() => props.visible, (newVisible) => {
  if (newVisible) {
    markerPlacementMode.value = true;
    emit('marker-mode-enabled');
  } else {
    resetState();
  }
}, { immediate: true });

// AI : Handle marker coordinates from map click
function setMarkerCoordinates(coordinates: { lat: number; lng: number }) {
  markerCoordinates.value = coordinates;
}

// AI : Cancel marker placement
function onCancel() {
  emit('update:visible', false);
}

// AI : Continue with marker coordinates
function onContinue() {
  if (markerCoordinates.value) {
    emit('marker-coordinates', markerCoordinates.value);
  }
  resetState();
  emit('update:visible', false);
}

// AI : Reset all state
function resetState() {
  markerCoordinates.value = null;
  markerPlacementMode.value = false;
}

// AI : Close dialog when map mode changes (prevents mixed mode states)
const overlayStore = useOverlayStore();
watch(() => overlayStore.mode, () => {
  if (markerPlacementMode.value) {
    onCancel();
  }
});

// AI : Expose functions to parent component
defineExpose({
  setMarkerCoordinates
});
</script>

<style scoped>
/* AI : Floating marker placement bar */
.marker-placement-bar {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: white;
  border: 1px solid var(--p-surface-300);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  max-width: calc(100vw - 40px);
  min-width: 280px;
  z-index: 2000;
}

.placement-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.placement-icon {
  color: var(--p-primary-600);
  font-size: 16px;
}

.placement-text {
  flex: 1;
}

.instruction {
  color: var(--p-surface-600);
  font-size: 14px;
}

.coordinates-text {
  font-family: monospace;
  font-size: 13px;
  color: var(--p-primary-700);
  font-weight: 500;
}

.placement-actions {
  display: flex;
  gap: 8px;
}

/* AI : Mobile responsive */
@media (max-width: 768px) {
  .marker-placement-bar {
    top: 10px;
    left: 10px;
    right: 10px;
    transform: none;
    max-width: none;
    min-width: auto;
  }
  
  .placement-content {
    gap: 6px;
  }
  
  .placement-actions {
    gap: 6px;
  }
}
</style>
