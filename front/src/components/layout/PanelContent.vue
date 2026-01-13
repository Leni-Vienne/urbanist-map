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
        class="signin-prompt"
      >
        <div class="signin-content">
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
import CurrentLocationPanel from "./CurrentLocationPanel.vue";

// AI : Lazy load panels to reduce initial bundle size
const ModerationPanel = defineAsyncComponent(() => import("./ModerationPanel.vue"));
const ContributePanel = defineAsyncComponent(() => import("./ContributePanel.vue"));

const authStore = useAuthStore();

defineProps<{
  activeTab: PanelTab;
  contentContainerClass: string;
}>();
</script>

<style scoped>
.signin-prompt {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 2rem;
}

.signin-content {
  text-align: center;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
</style>
