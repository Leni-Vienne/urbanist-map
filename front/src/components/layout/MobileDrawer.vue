<template>
  <DraggableDrawer v-model:height-percent="uiStore.mobileDrawerHeightPercent">
    <!-- Mode controls above drawer on mobile, with individual floor clamping -->
    <template #above="{ drawerHeightPx }">
      <div class="relative w-full h-0 pointer-events-none">
        <!-- Satellite Preview: Minimum floor 80px. Positioned Left. -->
        <div
          class="absolute left-0 bottom-0 w-full pointer-events-none"
          :style="{
            marginBottom: `${Math.max(0, 30 - Math.max(drawerHeightPx || 0, 65))}px`,
            zIndex: 10,
          }"
        >
          <SatellitePreview :in-drawer="true" />
        </div>

        <!-- Mode Controls: Minimum floor 110px. Centered. -->
        <div
          class="absolute left-0 bottom-0 w-full pointer-events-none flex justify-center"
          :style="{
            marginBottom: `${Math.max(0, 110 - Math.max(drawerHeightPx || 0, 65))}px`,
            zIndex: 20,
          }"
        >
          <ModeControls v-if="authStore.isAuthenticated" :is-mobile="true" />
        </div>
      </div>
    </template>

    <template #header>
      <!-- Hidden while a detail is open so the detail takes over the drawer, matching desktop. -->
      <div v-if="!detailVisible" class="flex flex-col">
        <div
          class="grid transition-[grid-template-rows] duration-200 ease-in-out"
          :class="activeTab === 'explore' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
        >
          <div class="overflow-hidden">
            <div class="title-container ml-4 pb-1">
              <h3 class="m-0 text-lg font-semibold text-color select-none leading-tight">
                {{ $t("app.title") }}
              </h3>
              <p class="mt-1 text-xs text-muted-color leading-tight">
                {{ $t("app.subtitle") }}
              </p>
            </div>
          </div>
        </div>

        <PanelTabs v-model:active-tab="activeTab" variant="mobile" />
      </div>
    </template>

    <!-- Tab content with the selected project/overlay detail layered above it as a slide-over,
         independent of the active tab (matching the desktop SideMenu). Its own close button hides
         it again, revealing the tab content below. -->
    <div class="relative flex-1 flex flex-col min-h-0">
      <PanelContent
        content-container-class="flex-1 flex flex-col min-h-0 bg-content-hover-background"
      />
      <Transition name="detail-slide-over">
        <div v-if="detailVisible" class="absolute inset-0 z-20 bg-content-background">
          <ProjectDetailPanel />
        </div>
      </Transition>
    </div>

    <template #footer>
      <PanelFooter compact />
    </template>
  </DraggableDrawer>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useDetailPanel } from "@/composables/layout/useDetailPanel";

import DraggableDrawer from "./DraggableDrawer.vue";
import PanelContent from "./PanelContent.vue";
import PanelFooter from "./PanelFooter.vue";
import PanelTabs from "./PanelTabs.vue";
import ModeControls from "@/components/map/ModeControls.vue";
import SatellitePreview from "@/components/map/SatellitePreview.vue";

// Lazy loaded so the detail panel shares the same async chunk scope as PanelContent's copy.
const ProjectDetailPanel = defineAsyncComponent(() => import("./ProjectDetailPanel.vue"));

const uiStore = useUiStore();
const authStore = useAuthStore();

// activeTab proxies uiStore (shared with the desktop SideMenu); detailVisible drives the detail
// slide-over (suppressed in edit mode, where ContributePanel renders the selection inline).
const { detailVisible, activeTab } = useDetailPanel();
</script>

<style scoped>
/* Detail slide-over rises and fades over the tab content, sliding back down on close. */
.detail-slide-over-enter-active,
.detail-slide-over-leave-active {
  transition:
    transform 0.22s ease-out,
    opacity 0.22s ease-out;
}

.detail-slide-over-enter-from,
.detail-slide-over-leave-to {
  transform: translateY(8px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .detail-slide-over-enter-active,
  .detail-slide-over-leave-active {
    transition: opacity 0.22s ease-out;
  }

  .detail-slide-over-enter-from,
  .detail-slide-over-leave-to {
    transform: none;
  }
}
</style>
