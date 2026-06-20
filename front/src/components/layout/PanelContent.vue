<template>
  <div :class="contentContainerClass">
    <KeepAlive>
      <CurrentLocationPanel v-if="activeTab === 'currentLocation'" />
      <LatestContributionsPanel v-else-if="activeTab === 'latest'" />
      <FilterPanel v-else-if="activeTab === 'filter'" />
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
import { computed, defineAsyncComponent, watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

import LatestContributionsPanel from "./LatestContributionsPanel.vue";

// Lazy load panels to reduce initial bundle size and allow Rolldown to deduplicate
// shared async imports (e.g. ProjectAccordionPanel) across a single async chunk scope
const CurrentLocationPanel = defineAsyncComponent(() => import("./CurrentLocationPanel.vue"));
const FilterPanel = defineAsyncComponent(() => import("./FilterPanel.vue"));
const ModerationPanel = defineAsyncComponent(() => import("./ModerationPanel.vue"));
const ContributePanel = defineAsyncComponent(() => import("./ContributePanel.vue"));
const ContributeGuestPanel = defineAsyncComponent(() => import("./ContributeGuestPanel.vue"));

const authStore = useAuthStore();
const uiStore = useUiStore();
const overlayStore = useOverlayStore();

// Tab is read straight from the store (single source of truth, see mapStore.mode).
const activeTab = computed(() => uiStore.activeTab);

// Switching to the latest tab clears any open detail so it does not linger when switching back.
watch(activeTab, (tab) => {
  if (tab === "latest") {
    overlayStore.closeOverlayDetail();
    uiStore.closeProjectDetail();
  }
});

defineProps<{
  contentContainerClass: string;
}>();
</script>
