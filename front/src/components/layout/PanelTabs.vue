<template>
  <!-- AI : Tab navigation -->
  <div class="flex bg-surface-0 border-b border-surface-100 shrink-0">
    <button
      :class="[
        'flex-1 border-b-2 bg-transparent font-medium cursor-pointer transition-all duration-150 text-center hover:bg-surface-50',
        variant === 'mobile' ? 'py-3 px-0 text-sm' : 'py-2 px-0 text-sm',
        activeTab === 'latest'
          ? 'font-semibold text-primary-600 border-primary-600 hover:text-primary-700'
          : 'text-surface-600 border-transparent hover:text-surface-700',
      ]"
      @click="$emit('update:activeTab', 'latest')"
    >
      {{ $t("navigation.latestContributions") }}
    </button>
    <button
      v-if="mapStore.selectedCity || mapStore.selectedCountryCode"
      :class="[
        'flex-1 border-b-2 bg-transparent font-medium cursor-pointer transition-all duration-150 text-center hover:bg-surface-50',
        variant === 'mobile' ? 'py-3 px-0 text-sm' : 'py-2 px-0 text-sm',
        activeTab === 'currentLocation'
          ? 'font-semibold text-primary-600 border-primary-600 hover:text-primary-700'
          : 'text-surface-600 border-transparent hover:text-surface-700',
      ]"
      @click="$emit('update:activeTab', 'currentLocation')"
    >
      {{ $t("navigation.currentLocation") }}
    </button>
    <button
      :class="[
        'flex-1 border-b-2 bg-transparent font-medium cursor-pointer transition-all duration-150 text-center hover:bg-surface-50',
        variant === 'mobile' ? 'py-3 px-0 text-sm' : 'py-2 px-0 text-sm',
        activeTab === 'contribute'
          ? 'font-semibold text-primary-600 border-primary-600 hover:text-primary-700'
          : 'text-surface-600 border-transparent hover:text-surface-700',
      ]"
      @click="handleUploadsTabClick"
    >
      {{ $t("navigation.contribute") }}
    </button>
    <button
      v-if="authStore.isModerator"
      :class="[
        'flex-1 border-b-2 bg-transparent font-medium cursor-pointer transition-all duration-150 text-center hover:bg-surface-50',
        variant === 'mobile' ? 'py-3 px-0 text-sm' : 'py-2 px-0 text-sm',
        activeTab === 'moderation'
          ? 'font-semibold text-primary-600 border-primary-600 hover:text-primary-700'
          : 'text-surface-600 border-transparent hover:text-surface-700',
      ]"
      @click="$emit('update:activeTab', 'moderation')"
    >
      {{ $t("moderation.title") }}
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
  variant?: "desktop" | "mobile";
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
    uiStore.authModalVisible = true;
  } else {
    emit("update:activeTab", "contribute");
  }
}
</script>
