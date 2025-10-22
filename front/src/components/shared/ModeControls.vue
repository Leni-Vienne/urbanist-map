<template>
  <!-- AI : Shared mode controls component - used in both desktop and mobile -->
  <div :class="isMobile ? 'mode-controls-wrapper-mobile' : 'mode-controls-wrapper'" @dblclick.stop>
    <div
      class="mode-indicator"
      :class="{ 'edit-mode': overlayStore.isEditMode }"
      v-tooltip.top="isMobile ? undefined : (overlayStore.isEditMode ? $t('map.editModeTooltip') : $t('map.viewModeTooltip'))"
      :title="isMobile ? (overlayStore.isEditMode ? $t('map.editModeTooltip') : $t('map.viewModeTooltip')) : undefined"
    >
      <i :class="['pi', overlayStore.isEditMode ? 'pi-pencil' : 'pi-eye']"></i>
      <span>{{ overlayStore.isEditMode ? $t('map.editMode') : $t('map.viewMode') }}</span>
    </div>
    
    <button
      @click="handleModeSwitch"
      class="mode-switch-button"
      :aria-label="$t('map.switchMode')"
      v-tooltip.top="isMobile ? undefined : $t('map.switchMode')"
      :title="isMobile ? $t('map.switchMode') : undefined"
    >
      <i class="pi pi-refresh"></i>
      <span>{{ $t('map.switch') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useToast } from '@composables/ui/useToast';
import { toggleEditMode } from '@composables/overlay/useOverlayModes';

defineProps<{
  isMobile?: boolean
}>();

const overlayStore = useOverlayStore();
const toast = useToast();

// AI : Track last toast time to prevent spam
let lastToastTime = 0;
const TOAST_THROTTLE_MS = 1000;

// AI : Handle mode switch
async function handleModeSwitch() {
  try {
    await toggleEditMode();
    
    // AI : Only show toast if enough time has passed since last one
    const now = Date.now();
    if (now - lastToastTime < TOAST_THROTTLE_MS) {
      return;
    }
    lastToastTime = now;
    
    const modeText = overlayStore.isEditMode ? 'Edit Mode' : 'View Mode';
    toast.add({
      severity: 'info',
      summary: `Switched to ${modeText}`,
      detail: overlayStore.isEditMode
        ? 'You can now add and edit overlays'
        : 'Overlays are now in view-only mode',
      life: 3000,
    });
  } catch (error) {
    console.error('Error toggling edit mode:', error);
    toast.add({
      severity: 'error',
      summary: 'Mode Switch Error',
      detail: 'Failed to switch mode. Please try again.',
      life: 3000
    });
  }
}
</script>

<style scoped>
/* AI : Mode controls wrapper - 3 column grid, mode in center, button on right */
.mode-controls-wrapper,
.mode-controls-wrapper-mobile {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  pointer-events: none;
}

/* AI : Mode indicator pill - in center column */
.mode-indicator {
  grid-column: 2;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border-radius: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-color);
  border: 2px solid var(--surface-border);
  transition: all 0.3s ease-in-out;
  pointer-events: auto;
  justify-self: center;
}

.mode-indicator.edit-mode {
  background: rgba(245, 158, 11, 0.95);
  border-color: #d97706;
  color: white;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
}

.mode-indicator i {
  font-size: 1rem;
}

/* AI : Discrete switch button - in right column at start */
.mode-switch-button {
  grid-column: 3;
  justify-self: start;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: none;
  border: none;
  padding: 0.35rem 0.5rem;
  margin-left: 0.5rem;
  cursor: pointer;
  color: white;
  font-size: 0.85rem;
  font-weight: 500;
  transition: transform 0.15s ease;
  pointer-events: auto;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}

.mode-switch-button:hover {
  transform: scale(1.05);
}

.mode-switch-button:active {
  transform: scale(0.95);
}

.mode-switch-button i {
  font-size: 0.9rem;
}

.mode-switch-button span {
  text-transform: lowercase;
}
</style>
