<template>
  <!-- AI : Tab navigation -->
  <div :class="tabContainerClass">
    <button
      :class="[tabButtonClass, { active: activeTab === 'latest' }]"
      @click="$emit('update:activeTab', 'latest')"
    >
      {{ $t("navigation.latestContributions") }}
    </button>
    <button
      v-if="mapStore.selectedCity || mapStore.selectedCountryCode"
      :class="[tabButtonClass, { active: activeTab === 'currentLocation' }]"
      @click="$emit('update:activeTab', 'currentLocation')"
    >
      {{ $t("navigation.currentLocation") }}
    </button>
    <button
      :class="[tabButtonClass, { active: activeTab === 'contribute' }]"
      @click="handleUploadsTabClick"
    >
      {{ $t("navigation.contribute") }}
    </button>
    <button
      v-if="authStore.isModerator"
      :class="[tabButtonClass, { active: activeTab === 'moderation' }]"
      @click="$emit('update:activeTab', 'moderation')"
    >
      {{ $t("navigation.moderation") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { PanelTab } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";

const authStore = useAuthStore();
const mapStore = useMapStore();
const uiStore = useUiStore();

defineProps<{
  activeTab: PanelTab;
  tabContainerClass: string;
  tabButtonClass: string;
}>();

const emit = defineEmits<{
  "update:activeTab": [tab: PanelTab];
}>();

// AI : Handle uploads tab click - show auth dialog if not authenticated
function handleUploadsTabClick() {
  if (!authStore.isAuthenticated) {
    // AI : Store intent to switch to uploads tab after login
    uiStore.setPostLoginCallback(() => {
      emit("update:activeTab", "contribute");
    });
    // AI : Open auth dialog
    uiStore.openAuthModal();
  } else {
    emit("update:activeTab", "contribute");
  }
}
</script>

<style scoped>
/* AI : Tab navigation base styles */
.tab-navigation,
.drawer-tabs {
  display: flex;
  background-color: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-100);
  flex-shrink: 0;
}

/* AI : Tab button base styles */
.tab-button,
.drawer-tab {
  flex: 1;
  padding: var(--tab-padding-y, 0.5rem) var(--tab-padding-x, 0);
  border: none;
  background: transparent;
  font-weight: 500;
  font-size: var(--tab-font-size, 0.875rem);
  cursor: pointer;
  transition: all 150ms ease-out;
  text-align: center;
  border-bottom: 2px solid transparent;
  color: var(--p-surface-600);
}

.tab-button:hover,
.drawer-tab:hover {
  color: var(--p-surface-700);
  background-color: var(--p-surface-50);
}

.tab-button.active,
.drawer-tab.active {
  font-weight: 600;
  color: var(--p-primary-600);
  border-bottom-color: var(--p-primary-600);
}

/* AI : Mobile drawer specific adjustments */
.drawer-tab {
  --tab-padding-y: 0.75rem;
}
</style>
