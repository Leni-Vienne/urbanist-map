<template>
  <!-- AI : Mobile Bottom Drawer - Custom Draggable Implementation -->
  <DraggableDrawer
    v-model:visible="isVisible"
    v-model:height-percent="drawerHeight"
    @height-changed="handleHeightChanged"
  >
    <!-- AI : Mode controls above drawer on mobile -->
    <template #above>
      <ModeControls v-if="authStore.isAuthenticated" :is-mobile="true" />
    </template>

    <!-- AI : Custom header with title and tab navigation -->
    <template #header>
      <div class="drawer-header-content">
        <div class="title-container">
          <h3 class="drawer-title">{{ $t('app.title') }}</h3>
          <p class="drawer-subtitle">{{ $t('app.subtitle') }}</p>
        </div>

        <!-- AI : Tab navigation inside fixed header -->
        <PanelTabs
          v-model:active-tab="activeTab"
          tab-container-class="drawer-tabs"
          tab-button-class="drawer-tab"
        />
      </div>
    </template>

    <!-- AI : Scrollable content area -->
    <PanelContent :active-tab="activeTab" content-container-class="drawer-content" />

    <!-- AI : Footer with legal links -->
    <div class="drawer-footer">
      <a href="/legal" class="footer-link">{{ $t("footer.legalMentions") }}</a>
      <span class="footer-separator">•</span>
      <a href="/contact" class="footer-link">{{ $t("footer.contact") }}</a>
    </div>
  </DraggableDrawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useUiStore } from "@/stores/uiStore";
import { usePanelTabs } from "@/composables/layout/usePanelTabs";

import DraggableDrawer from "./DraggableDrawer.vue";
import PanelContent from "./PanelContent.vue";
import PanelTabs from "./PanelTabs.vue";
import ModeControls from "@/components/map/ModeControls.vue";

const uiStore = useUiStore();

const isVisible = defineModel<boolean>("visible", { default: false });

// AI : Drawer height management
const drawerHeight = computed({
  get: () => uiStore.mobileDrawerHeightPercent,
  set: (value) => uiStore.setMobileDrawerHeight(value),
});

function handleHeightChanged(height: number) {
  uiStore.setMobileDrawerHeight(height);
}

// AI : Use UI store for active tab state
const activeTab = computed({
  get: () => uiStore.mobileDrawerActiveTab,
  set: (value) => uiStore.setMobileDrawerActiveTab(value),
});

// AI : Initialize shared tab logic (mode syncing, authentication watchers, overlay selection)
const { authStore } = usePanelTabs(activeTab);
</script>

<style scoped>
.drawer-header-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.drawer-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--p-surface-900);
  user-select: none;
  line-height: 1.2;
}

.drawer-subtitle {
  margin: 0.25rem 0 0 0;
  font-size: 0.75rem;
  color: var(--p-surface-500);
  line-height: 1.3;
}

.title-container {
  margin-left: 1rem;
}

:deep(.drawer-content) {
  flex: 1;
  overflow-y: auto;
  background-color: var(--p-surface-0);
  padding-bottom: 3rem;
  /* AI : Account for footer height */
}

.drawer-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0.2rem 1rem;
  background: var(--p-surface-50);
  border-top: 1px solid var(--p-surface-100);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
}

.footer-link {
  color: var(--p-surface-600);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: var(--p-surface-400);
  font-size: 0.65rem;
  transition: all 0.15s ease;
}

.footer-link:hover {
  color: var(--p-primary-600);
  text-decoration-color: var(--p-primary-600);
}

.footer-separator {
  color: var(--p-surface-400);
  font-size: 0.65rem;
}
</style>
