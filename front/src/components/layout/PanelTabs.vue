<template>
  <!-- Tab navigation -->
  <div class="flex bg-content-hover-background border-b border-surface shrink-0">
    <button
      :class="[
        'flex-1 border-b-2 bg-transparent font-medium cursor-pointer transition-all duration-150 text-center hover:bg-content-hover-background',
        variant === 'mobile' ? 'py-3 px-0 text-sm' : 'py-2 px-0 text-sm',
        activeTab === 'latest'
          ? 'font-semibold text-primary-color border-primary-color hover:text-primary-hover-color'
          : 'text-(--p-text-color-secondary) border-transparent hover:text-color',
      ]"
      @click="$emit('update:activeTab', 'latest')"
    >
      {{ $t("navigation.latestContributions") }}
    </button>
    <button
      :class="[
        'flex-1 border-b-2 bg-transparent font-medium cursor-pointer transition-all duration-150 text-center hover:bg-content-hover-background',
        variant === 'mobile' ? 'py-3 px-0 text-sm' : 'py-2 px-0 text-sm',
        activeTab === 'currentLocation'
          ? 'font-semibold text-primary-color border-primary-color hover:text-primary-hover-color'
          : 'text-(--p-text-color-secondary) border-transparent hover:text-color',
      ]"
      @click="$emit('update:activeTab', 'currentLocation')"
    >
      {{ $t("navigation.onMap") }}
    </button>
    <button
      :class="[
        'flex-1 border-b-2 bg-transparent font-medium cursor-pointer transition-all duration-150 text-center hover:bg-content-hover-background',
        variant === 'mobile' ? 'py-3 px-0 text-sm' : 'py-2 px-0 text-sm',
        activeTab === 'contribute'
          ? 'font-semibold text-primary-color border-primary-color hover:text-primary-hover-color'
          : 'text-(--p-text-color-secondary) border-transparent hover:text-color',
      ]"
      @click="$emit('update:activeTab', 'contribute')"
    >
      {{ $t("navigation.contribute") }}
    </button>
    <button
      v-if="authStore.isModerator"
      :class="[
        'flex-1 border-b-2 bg-transparent font-medium cursor-pointer transition-all duration-150 text-center hover:bg-content-hover-background',
        variant === 'mobile' ? 'py-3 px-0 text-sm' : 'py-2 px-0 text-sm',
        activeTab === 'moderation'
          ? 'font-semibold text-primary-color border-primary-color hover:text-primary-hover-color'
          : 'text-(--p-text-color-secondary) border-transparent hover:text-color',
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

const authStore = useAuthStore();

defineProps<{
  activeTab: PanelTab;
  variant?: "desktop" | "mobile";
}>();

const emit = defineEmits<{
  "update:activeTab": [tab: PanelTab];
}>();
</script>
