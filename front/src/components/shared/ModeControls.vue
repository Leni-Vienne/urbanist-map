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
import { toggleEditMode } from '@composables/overlay/useOverlayModes';
import { useI18n } from 'vue-i18n';
import type { MapMode } from '@types';
import { loadCountriesWithProjects, addCountryMarkersToMap } from '@composables/map/useCountryMarkers';
import { getSelectedCity } from '@composables/map/useCityData';
import { loadCityOverlays, renderOverlayMarkersFromCache } from '@composables/map/useCityOverlays';
import { useMapStore } from '@stores/pinia/mapStore';

defineProps<{
  isMobile?: boolean
}>();

const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const mapStore = useMapStore();
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
    case 'moderation': return 'Moderation'; // AI : Add to i18n later
    default: return t('map.viewMode');
  }
}

function getModeTooltip(): string {
  switch (overlayStore.mode) {
    case 'view': return t('map.viewModeTooltip');
    case 'edit': return t('map.editModeTooltip');
    case 'moderation': return 'Review pending submissions'; // AI : Add to i18n later
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

    // AI : For view<->edit, use existing toggleEditMode with full state machine
    if ((currentMode === 'view' && newMode === 'edit') ||
        (currentMode === 'edit' && newMode === 'view')) {
      await toggleEditMode();
    } else {
      // AI : For transitions involving moderation mode, do direct mode change and reload
      const selectedCity = getSelectedCity();

      // AI : Invalidate cache for selected city when switching modes
      if (selectedCity) {
        mapStore.clearCityProjectsCache(selectedCity.id);
        mapStore.clearCityDevelopmentProjectsCache(selectedCity.id);
      }

      // AI : Set new mode
      overlayStore.setMode(newMode);

      // AI : Reload data with new mode
      await loadCountriesWithProjects(true);
      addCountryMarkersToMap();

      // AI : Reload city data if a city is selected
      if (selectedCity) {
        await loadCityOverlays(selectedCity.id, true);
        renderOverlayMarkersFromCache(selectedCity.id);
      }
    }

    // AI : Only show toast if enough time has passed since last one
    const now = Date.now();
    if (now - lastToastTime >= TOAST_THROTTLE_MS) {
      lastToastTime = now;

      const modeText = getModeLabel();
      toast.add({
        severity: 'info',
        summary: `Switched to ${modeText}`,
        detail: getModeTooltip(),
        life: 3000,
      });
    }
  } catch (error) {
    console.error('Error toggling mode:', error);
    toast.add({
      severity: 'error',
      summary: 'Mode Switch Error',
      detail: 'Failed to switch mode. Please try again.',
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
