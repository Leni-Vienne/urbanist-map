<template>
  <DraggableDrawer
    v-model:height-percent="uiStore.mobileDrawerHeightPercent"
    :peek-target="peekTarget"
  >
    <template #above>
      <SatellitePreview in-drawer />
    </template>

    <template #header="{ collapsed }">
      <PanelTabs
        v-if="!detailVisible"
        class="h-(--drawer-tab-height)"
        :active-tab="collapsed ? null : uiStore.activeTab"
        variant="mobile"
        @update:active-tab="selectTab($event, collapsed)"
      />
    </template>

    <!-- Tab content with the selected project/overlay detail layered above it as a slide-over,
         independent of the active tab. Its own close button hides
         it again, revealing the tab content below. -->
    <div class="relative flex-1 flex flex-col min-h-0">
      <PanelContent />
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
import { computed, defineAsyncComponent } from "vue";
import { DEFAULT_MOBILE_DRAWER_HEIGHT_PERCENT, useUiStore } from "@/stores/uiStore";
import type { PanelTab } from "@/types";
import { useFocusStore } from "@/stores/focusStore";
import { useDetailPanel } from "@/composables/layout/useDetailPanel";

import DraggableDrawer from "./DraggableDrawer.vue";
import PanelContent from "./PanelContent.vue";
import PanelFooter from "./PanelFooter.vue";
import PanelTabs from "./PanelTabs.vue";
import SatellitePreview from "@/components/map/SatellitePreview.vue";

const ProjectDetailPanel = defineAsyncComponent(() => import("./ProjectDetailPanel.vue"));

const uiStore = useUiStore();
const focusStore = useFocusStore();

const { detailVisible } = useDetailPanel();
const peekTarget = computed(getPeekTarget);

function selectTab(tab: PanelTab, collapsed: boolean): void {
  uiStore.activeTab = tab;
  if (collapsed) uiStore.mobileDrawerHeightPercent = DEFAULT_MOBILE_DRAWER_HEIGHT_PERCENT;
}

function getPeekTarget(): string | null {
  const selection = focusStore.selection;
  if (!detailVisible.value || !selection) return null;
  return selection.kind === "overlay"
    ? `overlay:${selection.overlayId}`
    : `project:${selection.projectId}`;
}
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
