<template>
  <div :class="contentContainerClass">
    <!-- A selected map feature drives the panel into a detail state, replacing the tab content. -->
    <ProjectDetailPanel v-if="detailVisible" />
    <!-- KeepAlive preserves component state (scroll, data) when switching tabs -->
    <KeepAlive v-else>
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
import { computed, defineAsyncComponent, watch } from "vue";
import type { PanelTab } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

import LatestContributionsPanel from "./LatestContributionsPanel.vue";

// Lazy load panels to reduce initial bundle size and allow Rolldown to deduplicate
// shared async imports (e.g. ProjectAccordionPanel) across a single async chunk scope
const CurrentLocationPanel = defineAsyncComponent(() => import("./CurrentLocationPanel.vue"));
const ModerationPanel = defineAsyncComponent(() => import("./ModerationPanel.vue"));
const ContributePanel = defineAsyncComponent(() => import("./ContributePanel.vue"));
const ContributeGuestPanel = defineAsyncComponent(() => import("./ContributeGuestPanel.vue"));
const ProjectDetailPanel = defineAsyncComponent(() => import("./ProjectDetailPanel.vue"));

const authStore = useAuthStore();
const uiStore = useUiStore();
const overlayStore = useOverlayStore();

// The Contribute and Moderation tabs render the selected project/overlay inside their own
// accordion (which carries the edit and approve/reject action buttons), so the detail panel
// must not take over there. It is only used by the view-mode tabs (latest, current location),
// which have no project list of their own.
const panelOwnsProjectList = computed(
  () =>
    (uiStore.activeTab === "contribute" && authStore.isAuthenticated) ||
    (uiStore.activeTab === "moderation" && authStore.isModerator),
);

// A selected overlay (info popup) or standalone project marker drives the panel into a detail state.
// The latest tab is a feed of all-user contributions with no project list of its own, so it must
// never host a project detail.
const detailVisible = computed(
  () =>
    !panelOwnsProjectList.value &&
    uiStore.activeTab !== "latest" &&
    (overlayStore.showInfoPopup || uiStore.projectInfoPopup.visible),
);

// Switching to the latest tab clears any open detail so it does not linger when switching back.
watch(
  () => uiStore.activeTab,
  (tab) => {
    if (tab === "latest") {
      overlayStore.hideInfoPopup();
      uiStore.closeProjectInfoPopup();
    }
  },
);

defineProps<{
  activeTab: PanelTab;
  contentContainerClass: string;
}>();
</script>
