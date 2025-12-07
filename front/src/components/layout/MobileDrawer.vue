<template>
    <!-- AI : Mobile Bottom Drawer - Custom Draggable Implementation -->
    <DraggableDrawer
        v-model:visible="isVisible"
        v-model:height-percent="drawerHeight"
        :header="$t('app.title')"
        @height-changed="handleHeightChanged"
    >
        <!-- AI : Mode controls above drawer on mobile -->
        <template #above>
            <ModeControls v-if="authStore.isAuthenticated" :is-mobile="true" />
        </template>

        <!-- AI : Shared panel content with tabs -->
        <PanelContent
            v-model:active-tab="activeTab"
            tab-container-class="drawer-tabs"
            tab-button-class="drawer-tab"
            content-container-class="drawer-content"
        />

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

// AI : Use UI store for active tab state (shared with Home component)
const activeTab = computed({
    get: () => uiStore.mobileDrawerActiveTab,
    set: (value) => uiStore.setMobileDrawerActiveTab(value),
});

// AI : Initialize shared tab logic (mode syncing, authentication watchers)
const { authStore } = usePanelTabs(activeTab);
</script>

<style scoped>
:deep(.drawer-content) {
    flex: 1;
    overflow-y: auto;
    background-color: var(--p-surface-0);
    padding-bottom: 3rem; /* AI : Account for footer height */
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
