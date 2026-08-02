<template>
  <div :class="contentContainerClass">
    <KeepAlive>
      <ExplorePanel v-if="activeTab === 'latest'" />
      <!-- overflow-x hidden removes the spurious horizontal scrollbar from the sliders -->
      <div
        v-else-if="activeTab === 'filter'"
        class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4"
      >
        <FilterPanelContent :show-heading="false" />
      </div>
      <ContributePanel v-else-if="activeTab === 'contribute' && authStore.isAuthenticated" />
      <ContributeGuestPanel v-else-if="activeTab === 'contribute' && !authStore.isAuthenticated" />
      <ModerationPanel v-else-if="activeTab === 'moderation' && authStore.isModerator" />

      <!-- Show sign-in prompt for moderation tab when not authorized -->
      <div
        v-else-if="activeTab === 'moderation' && !authStore.isModerator"
        class="flex items-center justify-center h-full p-8"
      >
        <div class="text-center max-w-70 flex flex-col items-center">
          <i class="pi pi-user text-4xl text-muted-color mb-4"></i>
          <h3 class="text-lg font-semibold mb-2">{{ $t("auth.moderationAccessRequired") }}</h3>
          <p class="text-muted-color text-sm mb-4 text-center">
            {{ $t("auth.moderationMessage") }}
          </p>
        </div>
      </div>
    </KeepAlive>
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

// Tab is read straight from the store (single source of truth, see mapStore.mode).
const activeTab = computed(() => uiStore.activeTab);

defineProps<{
  contentContainerClass: string;
}>();
</script>
