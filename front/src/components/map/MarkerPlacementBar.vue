<template>
  <!-- AI : Floating bar for marker placement, positioned inside map container -->
  <Teleport to="#mapDiv">
    <!-- AI : Semi-transparent backdrop to focus attention on map -->
    <div
      v-if="markerPlacementMode && visible"
      class="marker-placement-backdrop"
    ></div>

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
    <!-- AI : Cursor-following marker icon until first click -->
    <div
      v-if="markerPlacementMode && visible && !markerCoordinates"
      class="cursor-marker"
      :style="{ left: cursorPosition.x + 'px', top: cursorPosition.y + 'px' }"
      v-html="cursorMarkerSvg"
    ></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import { useOverlayStore } from '@/stores/pinia/overlayStore';
import { map } from '@/composables/core/useMap';
import { getMarkerSvg } from '@/composables/map/useMarkers';

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
const cursorPosition = ref({ x: 0, y: 0 });
const cursorMarkerSvg = getMarkerSvg('orange');

// AI : Track mouse position over map for cursor-following marker
function onMouseMove(e: MouseEvent) {
  if (!map.value || markerCoordinates.value) return;
  const mapContainer = map.value.getContainer();
  const rect = mapContainer.getBoundingClientRect();
  cursorPosition.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

// AI : Setup/cleanup mouse move listener
watch(() => props.visible, (newVisible) => {
  if (newVisible) {
    document.addEventListener('mousemove', onMouseMove);
  } else {
    document.removeEventListener('mousemove', onMouseMove);
  }
}, { immediate: true });

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove);
});

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
/* AI : Semi-transparent backdrop to dim everything except the map area */
.marker-placement-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1998;
  pointer-events: none;
}

/* AI : Floating marker placement bar - positioned relative to map container */
.marker-placement-bar {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: white;
  border: 2px solid var(--p-primary-500);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 24px;
  max-width: calc(100vw - 40px);
  min-width: 320px;
  z-index: 2000;
}

/* AI : Cursor-following marker icon */
.cursor-marker {
  position: absolute;
  pointer-events: none;
  z-index: 1999;
  transform: translate(-50%, -100%);
}

.placement-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.placement-icon {
  color: var(--p-primary-600);
  font-size: 20px;
}

.placement-text {
  flex: 1;
}

.instruction {
  color: var(--p-surface-700);
  font-size: 16px;
  font-weight: 600;
}

.coordinates-text {
  font-family: monospace;
  font-size: 15px;
  color: var(--p-primary-700);
  font-weight: 600;
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
    padding: 14px 18px;
  }

  .placement-content {
    gap: 8px;
  }

  .placement-icon {
    font-size: 18px;
  }

  .instruction {
    font-size: 14px;
  }

  .coordinates-text {
    font-size: 13px;
  }

  .placement-actions {
    gap: 6px;
  }

  /* AI : Hide cursor marker on mobile (touch devices don't have cursor) */
  .cursor-marker {
    display: none;
  }
}
</style>
