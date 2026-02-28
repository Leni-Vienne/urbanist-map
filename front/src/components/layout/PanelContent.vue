<template>
  <!-- AI : Panel content -->
  <div :class="contentContainerClass">
    <!-- AI : Show content based on active tab -->
    <!-- AI : KeepAlive preserves component state (scroll, data) when switching tabs -->
    <KeepAlive>
      <LatestContributionsPanel v-if="activeTab === 'latest'" />
      <CurrentLocationPanel v-else-if="activeTab === 'currentLocation'" />
      <ContributePanel v-else-if="activeTab === 'contribute' && authStore.isAuthenticated" />
      <ModerationPanel v-else-if="activeTab === 'moderation' && authStore.isModerator" />

      <!-- AI : Show sign-in prompt for uploads and moderation tabs when not authenticated/authorized -->
      <div
        v-else-if="
          (activeTab === 'contribute' && !authStore.isAuthenticated) ||
          (activeTab === 'moderation' && !authStore.isModerator)
        "
        class="flex items-center justify-center h-full p-8"
      >
        <div class="text-center max-w-[280px] flex flex-col items-center">
          <i class="pi pi-user text-4xl text-muted-color mb-4"></i>
          <h3 class="text-lg font-semibold mb-2">
            {{
              authStore.isAuthenticated
                ? $t("auth.moderationAccessRequired")
                : $t("auth.authenticationRequired")
            }}
          </h3>
          <p class="text-muted-color text-sm mb-4 text-center">
            {{
              authStore.isAuthenticated ? $t("auth.moderationMessage") : $t("auth.signInMessage")
            }}
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

// AI : Lazy load panels to reduce initial bundle size and allow Rolldown to deduplicate
// AI : shared async imports (e.g. ProjectAccordionPanel) across a single async chunk scope
const CurrentLocationPanel = defineAsyncComponent(() => import("./CurrentLocationPanel.vue"));
const ModerationPanel = defineAsyncComponent(() => import("./ModerationPanel.vue"));
const ContributePanel = defineAsyncComponent(() => import("./ContributePanel.vue"));

const authStore = useAuthStore();

defineProps<{
  activeTab: PanelTab;
  contentContainerClass: string;
}>();
</script>
