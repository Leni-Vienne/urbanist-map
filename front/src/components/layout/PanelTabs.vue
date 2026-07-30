<template>
  <!-- Tab navigation -->
  <div class="flex bg-content-hover-background border-b border-surface shrink-0">
    <template v-for="tab in TABS" :key="tab.key">
      <button
        v-if="
          (!tab.mobileOnly || variant === 'mobile') &&
          (!tab.requiresModerator || authStore.isModerator)
        "
        :class="[
          'flex-1 py-2 px-0 text-sm border-b-2 bg-transparent font-medium cursor-pointer transition-all duration-150 text-center hover:bg-content-hover-background',
          activeTab === tab.key
            ? 'font-semibold text-primary-color border-primary-color hover:text-primary-hover-color'
            : 'text-(--p-text-color-secondary) border-transparent hover:text-color',
        ]"
        @click="$emit('update:activeTab', tab.key)"
      >
        {{ variant === "mobile" && tab.mobileLabelKey ? $t(tab.mobileLabelKey) : $t(tab.labelKey) }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { PanelTab } from "@/types";
import { useAuthStore } from "@/stores/authStore";

const authStore = useAuthStore();

const TABS: {
  key: PanelTab;
  labelKey: string;
  mobileLabelKey?: string;
  mobileOnly?: boolean;
  requiresModerator?: boolean;
}[] = [
  {
    key: "latest",
    labelKey: "navigation.latestContributions",
    mobileLabelKey: "navigation.latestContributionsShort",
  },
  { key: "filter", labelKey: "navigation.filter", mobileOnly: true },
  { key: "contribute", labelKey: "navigation.contribute" },
  { key: "moderation", labelKey: "moderation.title", requiresModerator: true },
];

defineProps<{
  activeTab: PanelTab;
  variant?: "desktop" | "mobile";
}>();

defineEmits<{
  "update:activeTab": [tab: PanelTab];
}>();
</script>
