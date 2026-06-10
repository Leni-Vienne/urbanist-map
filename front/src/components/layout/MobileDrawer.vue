<template>
  <DraggableDrawer
    v-model:visible="isVisible"
    v-model:height-percent="drawerHeight"
    @height-changed="handleHeightChanged"
  >
    <!-- Mode controls above drawer on mobile, with individual floor clamping -->
    <template #above="{ drawerHeightPx }">
      <div class="relative w-full h-0 pointer-events-none">
        <!-- Satellite Preview: Minimum floor 80px. Positioned Left. -->
        <div
          class="absolute left-0 bottom-0 w-full pointer-events-none"
          :style="{
            marginBottom: `${Math.max(0, 30 - Math.max(drawerHeightPx || 0, 65))}px`,
            zIndex: isSatelliteMenuOpen ? 30 : 10,
          }"
        >
          <SatellitePreview :in-drawer="true" @menu-change="handleSatelliteMenuChange" />
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
      <div class="flex flex-col gap-1">
        <div class="title-container ml-4">
          <h3 class="m-0 text-lg font-semibold text-color select-none leading-tight">
            {{ $t("app.title") }}
          </h3>
          <p class="mt-1 text-xs text-muted-color leading-tight">
            {{ $t("app.subtitle") }}
          </p>
        </div>

        <PanelTabs v-model:active-tab="activeTab" variant="mobile" />
      </div>
    </template>

    <PanelContent
      :active-tab="activeTab"
      content-container-class="flex-1 flex flex-col min-h-0 bg-content-hover-background"
    />

    <!-- Footer with legal links (rendered outside the scroll area via slot).
         pb adds env(safe-area-inset-bottom) so the OS-reserved area (gesture pill,
         classic nav bar, home indicator) doesn't overlap the links. -->
    <template #footer>
      <div
        class="pt-[0.2rem] pb-[calc(0.2rem+env(safe-area-inset-bottom))] px-4 bg-content-hover-background border-t border-surface flex justify-center items-center gap-2"
      >
        <a
          href="/legal"
          class="text-(--p-text-color-secondary) underline underline-offset-2 decoration-(--p-text-muted-color) text-[0.65rem] transition-all duration-150 hover:text-primary-color hover:decoration-primary-color"
          >{{ $t("footer.legal") }}</a
        >
        <span class="text-muted-color text-[0.65rem]">•</span>
        <a
          href="/contact"
          class="text-(--p-text-color-secondary) underline underline-offset-2 decoration-(--p-text-muted-color) text-[0.65rem] transition-all duration-150 hover:text-primary-color hover:decoration-primary-color"
          >{{ $t("common.contact") }}</a
        >
        <span class="text-muted-color text-[0.65rem]">•</span>
        <a
          href="https://github.com/Leni-Vienne/urbanist-map"
          target="_blank"
          rel="noopener noreferrer"
          class="group inline-flex items-center gap-1 text-(--p-text-color-secondary) text-[0.65rem] transition-all duration-150 hover:text-primary-color"
        >
          <i class="pi pi-github text-[0.65rem]"></i>
          <span
            class="underline underline-offset-2 decoration-(--p-text-muted-color) group-hover:decoration-primary-color"
            >{{ $t("footer.github") }}</span
          >
        </a>
      </div>
    </template>
  </DraggableDrawer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import type { PanelTab } from "@/types";

import DraggableDrawer from "./DraggableDrawer.vue";
import PanelContent from "./PanelContent.vue";
import PanelTabs from "./PanelTabs.vue";
import ModeControls from "@/components/map/ModeControls.vue";
import SatellitePreview from "@/components/map/SatellitePreview.vue";

const uiStore = useUiStore();
const authStore = useAuthStore();

const isVisible = defineModel<boolean>("visible", { default: false });
const isSatelliteMenuOpen = ref(false);

function handleSatelliteMenuChange(isOpen: boolean) {
  isSatelliteMenuOpen.value = isOpen;
}

// Drawer height management
const drawerHeight = computed({
  get: () => uiStore.mobileDrawerHeightPercent,
  set: (value) => {
    uiStore.mobileDrawerHeightPercent = Math.min(75, value);
  },
});

function handleHeightChanged(height: number) {
  uiStore.mobileDrawerHeightPercent = Math.min(90, height);
}

// Computed with getter/setter for v-model compatibility, uiStore.activeTab shared with SideMenu
const activeTab = computed<PanelTab>({
  get: () => uiStore.activeTab,
  set: (value) => (uiStore.activeTab = value),
});
</script>
