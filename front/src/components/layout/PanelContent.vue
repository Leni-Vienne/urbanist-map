<template>
  <div :class="contentContainerClass">
    <!-- KeepAlive preserves component state (scroll, data) when switching tabs -->
    <KeepAlive>
      <LatestContributionsPanel v-if="activeTab === 'latest'" />
      <CurrentLocationPanel v-else-if="activeTab === 'currentLocation'" />
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
import { defineAsyncComponent } from "vue";
import type { PanelTab } from "@/types";
import { useAuthStore } from "@/stores/authStore";

import LatestContributionsPanel from "./LatestContributionsPanel.vue";

// Lazy load panels to reduce initial bundle size and allow Rolldown to deduplicate
// shared async imports (e.g. ProjectAccordionPanel) across a single async chunk scope
const CurrentLocationPanel = defineAsyncComponent(() => import("./CurrentLocationPanel.vue"));
const ModerationPanel = defineAsyncComponent(() => import("./ModerationPanel.vue"));
const ContributePanel = defineAsyncComponent(() => import("./ContributePanel.vue"));
const ContributeGuestPanel = defineAsyncComponent(() => import("./ContributeGuestPanel.vue"));

const authStore = useAuthStore();

defineProps<{
  activeTab: PanelTab;
  contentContainerClass: string;
}>();
</script>
