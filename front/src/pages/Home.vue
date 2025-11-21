<template>
    <div class="home-container">
        <!-- AI : Desktop SideMenu -->
        <SideMenu
            v-if="!isMobile"
            :is-open="desktopSideMenuOpen"
            :is-moderator="authStore.isModerator"
            @close="() => (desktopSideMenuOpen = false)"
        />

        <!-- AI : Mobile Bottom Drawer -->
        <MobileDrawer v-if="isMobile" v-model:visible="mobileSideMenuOpen" />

        <div class="main-content">
            <Toast />

            <!-- AI : Info message banner (displayed at top when config.infoMessage is set) -->
            <Message
                v-if="authStore.infoMessage && !infoBannerDismissed"
                severity="info"
                :closable="true"
                @close="infoBannerDismissed = true"
                class="info-message-banner"
                icon="pi pi-info-circle"
            >
                {{authStore.infoMessage }}
            </Message>

            <!-- AI : Map container that fills remaining space -->
            <div class="map-container">
                <MapView />
            </div>

            <!-- AI : Popup container handles both overlay and project popups -->
            <PopupContainer
                v-if="
                    overlayStore.showInfoPopup ||
                    uiStore.projectInfoPopup.visible
                "
            />
        </div>

        <!-- AI : Project Management Dialogs -->
        <ProjectManager
            v-if="
                uiStore.projectDialog.visible ||
                uiStore.imageUploadDialogVisible ||
                uiStore.projectSelectorVisible ||
                uiStore.projectEditForm.visible ||
                uiStore.overlayEditForm.visible
            "
        />

        <!-- AI : Moderated Contributions Dialog -->
        <ModeratedContributionsDialog
            v-if="uiStore.moderatedContributionsDialogVisible"
            v-model:visible="uiStore.moderatedContributionsDialogVisible"
            @close="uiStore.closeModeratedContributionsDialog"
        />
    </div>
</template>

<script setup lang="ts">
import {
    onMounted,
    ref,
    onUnmounted,
    computed,
    defineAsyncComponent,
    watch,
} from "vue";

import { useOverlayStore } from "@stores/pinia/overlayStore";
import { useAuthStore } from "@stores/authStore";
import { useUiStore } from "@stores/uiStore";
import { useToast } from "@composables/ui/useToast";
import { useBeforeUnload } from "@composables/core/useBeforeUnload";
import { storeToRefs } from "pinia";
import { useRoute } from "vue-router";
import { useModeratedContributions } from "@composables/moderation/useModeratedContributions";
import { useI18n } from "@composables/useI18n";


import MapView from "@components/map/MapView.vue";
import SideMenu from "@components/layout/SideMenu.vue";
import MobileDrawer from "@components/layout/MobileDrawer.vue";

// AI : Split PopupContainer into separate chunk - loads when first popup is shown
const PopupContainer = defineAsyncComponent(
    () => import("@components/map/PopupContainer.vue"),
);
const ProjectManager = defineAsyncComponent(
    () => import("@components/project/ProjectManager.vue"),
);
// AI : Async import for non-critical dialog - only loaded when needed
const ModeratedContributionsDialog = defineAsyncComponent(
    () => import("@components/moderation/ModeratedContributionsDialog.vue"),
);

// AI : Create refs to track app state
const desktopSideMenuOpen = ref(true); // AI : Open by default on desktop
const infoBannerDismissed = ref(false);
const overlayStore = useOverlayStore();
const authStore = useAuthStore();
const uiStore = useUiStore();
const toast = useToast();
const route = useRoute();
const { fetchModeratedContributions, hasUnacknowledgedItems, reset: resetModeratedContributions } = useModeratedContributions();
const { t } = useI18n();

// AI : Use mobile drawer state from UI store
const mobileSideMenuOpen = computed({
    get: () => uiStore.mobileDrawerVisible,
    set: (value) => {
        uiStore.mobileDrawerVisible = value;
    },
});

// AI : Mobile detection for responsive drawer behavior
const windowWidth = ref(
    typeof window !== "undefined" ? window.innerWidth : 1024,
);
const isMobile = computed(() => windowWidth.value <= 768);

// AI : Update window width on resize
function updateWindowWidth() {
    windowWidth.value = window.innerWidth;

    // AI : Update mobile overflow constraints when window size changes
    if (isMobile.value) {
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
        document.body.style.height = "100vh";
        document.body.style.height = "100dvh";
    } else {
        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";
        document.body.style.height = "";
    }
}

const { pendingImageFile } = storeToRefs(overlayStore);

// AI : Initialize beforeunload handler for modified overlays
useBeforeUnload();

// AI : Handle window visibility change to close UI elements when user switches tabs/apps
function handleVisibilityChange() {
    // AI : Only close dialogs when the page becomes hidden (user switched tabs/minimized window)
    // AI : This is more reliable than blur events and doesn't interfere with native dialogs
    if (document.hidden) {
        // AI : Don't close if we're in the middle of critical user flows
        if (
            !pendingImageFile.value &&
            !uiStore.imageUploadDialogVisible &&
            !uiStore.projectSelectorVisible
        ) {
            overlayStore.closeAllUIElements();
        }
    }
}

onMounted(async () => {
    // AI : Add visibility change listener to close UI elements when user switches tabs/apps
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // AI : Add window resize listener for mobile detection
    window.addEventListener("resize", updateWindowWidth);

    // preload PopupContainer chunk on page load. Not needed on page load but improves responsiveness when first popup is shown
    import("@components/map/PopupContainer.vue");

    // AI : Prevent page scrolling on mobile to avoid viewport issues
    if (isMobile.value) {
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
        document.body.style.height = "100vh";
        document.body.style.height = "100dvh"; // Use dynamic viewport where supported
    }

    // AI : Update overlayStore to use the new UI store for dialog control
    overlayStore.closeAllUIElements = uiStore.closeAllDialogs;

    try {
        await authStore.initialize();

        // AI : Check for moderated contributions if user is logged in
        if (authStore.isAuthenticated) {
            await fetchModeratedContributions();

            // AI : Show dialog if there are unacknowledged items
            if (hasUnacknowledgedItems.value) {
                uiStore.openModeratedContributionsDialog();
            }
        }

        // AI : Handle auth query parameters from URL
        if (route.query.auth === "success") {
            toast.add({
                severity: "success",
                summary: t('common.success'),
                detail: t('pages.home.signInSuccess'),
                life: 3000,
            });
        } else if (route.query.error) {
            const errorMessage = getErrorMessage(route.query.error as string);
            toast.add({
                severity: "error",
                summary: t('pages.home.authenticationError'),
                detail: errorMessage,
                life: 5000,
            });
        }
    } catch (error) {
        console.error("Error during application initialization:", error);
    }
});

// AI : Watch for authentication changes to fetch moderated contributions when user logs in
watch(() => authStore.isAuthenticated, async (isAuthenticated, wasAuthenticated) => {
    if (isAuthenticated && !wasAuthenticated) {
        // AI : User just logged in - fetch moderated contributions
        await fetchModeratedContributions();

        // AI : Show dialog if there are unacknowledged items
        if (hasUnacknowledgedItems.value) {
            uiStore.openModeratedContributionsDialog();
        }
    } else if (!isAuthenticated && wasAuthenticated) {
        // AI : User just logged out - clear cached contributions
        resetModeratedContributions();
    }
});

// AI : Get user-friendly error messages
function getErrorMessage(error: string): string {
    switch (error) {
        case "auth_failed":
            return t('pages.home.errors.authenticationFailed');
        case "no_session":
            return t('pages.home.errors.signInCancelled');
        case "unexpected":
            return t('pages.home.errors.unexpectedError');
        default:
            return t('pages.home.errors.authenticationError');
    }
}

onUnmounted(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("resize", updateWindowWidth);

    // AI : Restore normal overflow behavior when component unmounts
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    document.body.style.height = "";
});
</script>

<style scoped>
.home-container {
    display: flex;
    height: 100vh;
}

.main-content {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    position: relative;
}

.info-message-banner {
    flex-shrink: 0;
    margin: 0;
    border-radius: 0;
}

.map-container {
    flex: 1;
    position: relative;
    overflow: hidden;
}
</style>
