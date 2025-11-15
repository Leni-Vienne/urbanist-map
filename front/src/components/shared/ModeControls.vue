<template>
  <!-- AI : Shared mode controls component - used in both desktop and mobile -->
  <div :class="isMobile ? 'mode-controls-wrapper-mobile' : 'mode-controls-wrapper'" @dblclick.stop>
    <div
      class="mode-indicator"
      :class="{
        'edit-mode': overlayStore.mode === 'edit',
        'moderation-mode': overlayStore.mode === 'moderation'
      }"
      v-tooltip.top="isMobile ? undefined : getModeTooltip()"
      :title="isMobile ? getModeTooltip() : undefined"
    >
      <i :class="['pi', getModeIcon()]"></i>
      <span>{{ getModeLabel() }}</span>
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
import { useAuthStore } from '@stores/authStore';
import { useToast } from '@composables/ui/useToast';
import { switchMode } from '@composables/overlay/useOverlayModes';
import { useI18n } from 'vue-i18n';
import type { MapMode } from '@types';

defineProps<{
  isMobile?: boolean
}>();

const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const toast = useToast();
const { t } = useI18n();

// AI : Track last toast time to prevent spam
let lastToastTime = 0;
const TOAST_THROTTLE_MS = 1000;

// AI : Flag to prevent recursive mode switching
let isSwitchingMode = false;

// AI : Get mode display info
function getModeIcon(): string {
  switch (overlayStore.mode) {
    case 'view': return 'pi-eye';
    case 'edit': return 'pi-pencil';
    case 'moderation': return 'pi-shield';
    default: return 'pi-eye';
  }
}

function getModeLabel(): string {
  switch (overlayStore.mode) {
    case 'view': return t('map.viewMode');
    case 'edit': return t('map.editMode');
    case 'moderation': return t('moderation.title');
    default: return t('map.viewMode');
  }
}

function getModeTooltip(): string {
  switch (overlayStore.mode) {
    case 'view': return t('map.viewModeTooltip');
    case 'edit': return t('map.editModeTooltip');
    case 'moderation': return t('moderation.description');
    default: return t('map.viewModeTooltip');
  }
}

// AI : Cycle through modes (view -> edit -> moderation -> view) for moderators
// AI : For regular users, just toggle between view and edit
async function handleModeSwitch() {
  // AI : Prevent recursive calls
  if (isSwitchingMode) {
    return;
  }

  try {
    isSwitchingMode = true;
    const currentMode = overlayStore.mode;

    let newMode: MapMode;

    if (authStore.isModerator) {
      // AI : Moderators cycle through all 3 modes
      switch (currentMode) {
        case 'view':
          newMode = 'edit';
          break;
        case 'edit':
          newMode = 'moderation';
          break;
        case 'moderation':
          newMode = 'view';
          break;
        default:
          newMode = 'view';
      }
    } else {
      // AI : Regular users toggle between view and edit only
      newMode = currentMode === 'edit' ? 'view' : 'edit';
    }

    // AI : Don't do anything if mode hasn't changed
    if (currentMode === newMode) {
      isSwitchingMode = false;
      return;
    }

    // AI : Use unified switchMode for all mode transitions (view/edit/moderation)
    // AI : This ensures consistent behavior and proper data reloading
    await switchMode(newMode);

    // AI : Only show toast if enough time has passed since last one
    const now = Date.now();
    if (now - lastToastTime >= TOAST_THROTTLE_MS) {
      lastToastTime = now;

      toast.add({
        severity: 'info',
        summary: t('moderation.switchedToEditMode'),
        detail: getModeTooltip(),
        life: 3000,
      });
    }
  } catch (error) {
    console.error('Error toggling mode:', error);
    toast.add({
      severity: 'error',
      summary: t('moderation.modeSwitchError'),
      detail: t('moderation.modeSwitchErrorDetail'),
      life: 3000
    });
  } finally {
    isSwitchingMode = false;
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

.mode-indicator.moderation-mode {
  background: rgba(59, 130, 246, 0.95);
  border-color: #2563eb;
  color: white;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
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
