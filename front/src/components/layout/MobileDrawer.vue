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

        <div class="drawer-tabs">
            <button
                :class="['drawer-tab', { active: activeTab === 'latest' }]"
                @click="activeTab = 'latest'"
            >
                {{ $t("navigation.latestContributions") }}
            </button>
            <button
                v-if="authStore.isAuthenticated"
                :class="['drawer-tab', { active: activeTab === 'uploads' }]"
                @click="activeTab = 'uploads'"
            >
                {{ $t("navigation.myContributions") }}
            </button>
            <button
                v-if="authStore.isModerator"
                :class="['drawer-tab', { active: activeTab === 'moderation' }]"
                @click="activeTab = 'moderation'"
            >
                {{ $t("navigation.moderation") }}
            </button>
        </div>

        <div class="drawer-content">
            <!-- AI : Show content based on active tab -->
            <LatestOverlaysPanel v-if="activeTab === 'latest'" />
            <MyContributionsPanel
                v-else-if="activeTab === 'uploads' && authStore.isAuthenticated"
            />
            <ModerationPanel
                v-else-if="activeTab === 'moderation' && authStore.isModerator"
            />

            <!-- AI : Show sign-in prompt for authenticated tabs when not signed in -->
            <div
                v-else-if="
                    (!authStore.isAuthenticated &&
                        (activeTab === 'uploads' ||
                            activeTab === 'moderation')) ||
                    (activeTab === 'moderation' && !authStore.isModerator)
                "
                class="signin-prompt"
            >
                <div class="signin-content">
                    <i class="pi pi-user text-4xl text-muted-color mb-4"></i>
                    <h3 class="text-lg font-semibold mb-2">
                        {{
                            activeTab === "moderation" &&
                            authStore.isAuthenticated &&
                            !authStore.isModerator
                                ? $t("auth.moderationAccessRequired")
                                : $t("auth.authenticationRequired")
                        }}
                    </h3>
                    <p class="text-muted-color text-sm mb-4 text-center">
                        {{
                            activeTab === "moderation" &&
                            authStore.isAuthenticated &&
                            !authStore.isModerator
                                ? $t("auth.moderationMessage")
                                : $t("auth.signInMessage")
                        }}
                    </p>
                </div>
            </div>
        </div>

        <!-- AI : Footer with legal links -->
        <div class="drawer-footer">
            <a href="/legal" class="footer-link">{{
                $t("footer.legalMentions")
            }}</a>
            <span class="footer-separator">•</span>
            <a href="/contact" class="footer-link">{{
                $t("footer.contact")
            }}</a>
        </div>
    </DraggableDrawer>
</template>

<script setup lang="ts">
import { defineAsyncComponent, watch, computed } from "vue";
import DraggableDrawer from "./DraggableDrawer.vue";
import LatestOverlaysPanel from "./LatestOverlaysPanel.vue"; // AI : static import since it's the default panel
import ModeControls from "@components/shared/ModeControls.vue";
import { useAuthStore } from "@stores/authStore";
import { useUiStore } from "@stores/uiStore";
import { useOverlayStore } from "@stores/pinia/overlayStore";
import type { MapMode } from "@types";

// AI : Lazy load panels to reduce initial bundle size
const ModerationPanel = defineAsyncComponent(
    () => import("./ModerationPanel.vue"),
);
const MyContributionsPanel = defineAsyncComponent(
    () => import("./MyContributionsPanel.vue"),
);

const authStore = useAuthStore();
const uiStore = useUiStore();
const overlayStore = useOverlayStore();

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

// AI : Flag to prevent infinite loops when syncing tab and mode
let isSyncing = false;

// AI : Map tab to mode
function tabToMode(tab: typeof activeTab.value): MapMode {
    switch (tab) {
        case "latest": return "view";
        case "uploads": return "edit";
        case "moderation": return "moderation";
        default: return "view";
    }
}

// AI : Map mode to tab
function modeToTab(mode: MapMode): typeof activeTab.value {
    switch (mode) {
        case "view": return "latest";
        case "edit": return "uploads";
        case "moderation": return "moderation";
        default: return "latest";
    }
}

// AI : Watch activeTab and sync mode
watch(activeTab, (newTab) => {
    if (isSyncing) return;
    isSyncing = true;

    const newMode = tabToMode(newTab);
    if (overlayStore.mode !== newMode) {
        overlayStore.setMode(newMode);
    }

    isSyncing = false;
});

// AI : Watch mode and sync activeTab
watch(() => overlayStore.mode, (newMode) => {
    if (isSyncing) return;
    isSyncing = true;

    const newTab = modeToTab(newMode);
    if (activeTab.value !== newTab) {
        activeTab.value = newTab;
    }

    isSyncing = false;
});

// AI : Watch for authentication changes and reset tab if user signs out or loses moderation rights
watch(
    () => authStore.isAuthenticated,
    (isAuthenticated) => {
        if (
            !isAuthenticated &&
            (activeTab.value === "uploads" || activeTab.value === "moderation")
        ) {
            activeTab.value = "latest";
        }
    },
);

// AI : Watch for moderation role changes and reset moderation tab if user loses moderation rights
watch(
    () => authStore.isModerator,
    (isModerator) => {
        if (!isModerator && activeTab.value === "moderation") {
            activeTab.value = "latest";
        }
    },
);
</script>

<style scoped>
.drawer-tabs {
    display: flex;
    background-color: var(--p-surface-0);
    border-bottom: 1px solid var(--p-surface-100);
    flex-shrink: 0;
}

.drawer-tab {
    flex: 1;
    padding: 0.75rem 0;
    border: none;
    background: transparent;
    font-weight: 500;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 150ms ease-out;
    text-align: center;
    border-bottom: 2px solid transparent;
    color: var(--p-surface-600);
}

.drawer-tab:hover {
    color: var(--p-surface-700);
    background-color: var(--p-surface-50);
}

.drawer-tab.active {
    font-weight: 600;
    color: var(--p-primary-600);
    border-bottom-color: var(--p-primary-600);
}

.drawer-content {
    flex: 1;
    overflow-y: auto;
    background-color: var(--p-surface-0);
    padding-bottom: 3rem; /* AI : Account for footer height */
}

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
    text-decoration: none;
    font-size: 0.65rem;
    transition: color 0.2s ease;
}

.footer-link:hover {
    color: var(--p-primary-600);
    text-decoration: underline;
}

.footer-separator {
    color: var(--p-surface-400);
    font-size: 0.65rem;
}
</style>
