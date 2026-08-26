<template>
  <div :class="contentContainerClass">
    <ExplorePanel v-show="activeTab === 'explore'" />
    <!-- overflow-x hidden removes the spurious horizontal scrollbar from the sliders -->
    <div v-if="activeTab === 'filter'" class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4">
      <FilterPanelContent :show-heading="false" />
    </div>
    <ContributePanel v-else-if="activeTab === 'contribute' && authStore.isAuthenticated" />
    <ContributeGuestPanel v-else-if="activeTab === 'contribute' && !authStore.isAuthenticated" />
    <ModerationPanel v-else-if="activeTab === 'moderation' && authStore.isModerator" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";

import FilterPanelContent from "@/components/map/FilterPanelContent.vue";
import ExplorePanel from "./ExplorePanel.vue";

// Lazy load panels to reduce initial bundle size and allow Rolldown to deduplicate
// shared async imports (e.g. ProjectAccordionPanel) across a single async chunk scope
const ModerationPanel = defineAsyncComponent(() => import("./ModerationPanel.vue"));
const ContributePanel = defineAsyncComponent(() => import("./ContributePanel.vue"));
const ContributeGuestPanel = defineAsyncComponent(() => import("./ContributeGuestPanel.vue"));

const authStore = useAuthStore();
const uiStore = useUiStore();

// Tab and its derived map mode share this single source of truth.
const activeTab = computed(() => uiStore.activeTab);

defineProps<{
  contentContainerClass: string;
}>();
</script>
