import { watch, nextTick, type Ref } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { switchMode } from "@/composables/overlay/useOverlayModes";
import type { MapMode } from "@shared/types";
import type { PanelTab } from "@/types";

/**
 * AI : Map tab to overlay mode
 */
function tabToMode(tab: PanelTab): MapMode {
  switch (tab) {
    case "latest":
      return "view";
    case "currentCity":
      // AI : Current city tab always shows view mode (approved overlays only)
      return "view";
    case "uploads":
      return "edit";
    case "moderation":
      return "moderation";
  }
}

/**
 * AI : Map overlay mode to tab
 */
function modeToTab(mode: MapMode): PanelTab {
  switch (mode) {
    case "view":
      return "latest";
    case "edit":
      return "uploads";
    case "moderation":
      return "moderation";
  }
}

/**
 * AI : Composable for managing panel tabs and mode synchronization
 * AI : Shared between SideMenu.vue and MobileDrawer.vue
 */
export function usePanelTabs(initialTab: Ref<PanelTab>) {
  const authStore = useAuthStore();
  const overlayStore = useOverlayStore();

  // AI : Flag to prevent infinite loops when syncing tab and mode
  let isSyncing = false;

  /**
   * AI : Watch activeTab and switch mode with full state machine transition
   * AI : Now uses switchMode() for consistent data reloading across all UI elements
   */
  watch(initialTab, async (newTab) => {
    if (isSyncing) return;
    isSyncing = true;

    try {
      const newMode = tabToMode(newTab);

      if (overlayStore.mode !== newMode) {
        // AI : Use unified switchMode function for proper data reload and cache invalidation
        // AI : This ensures each mode displays the correct data (approved, user's own, or pending)
        await switchMode(newMode);
      }
    } finally {
      // AI : Use nextTick to ensure mode watcher completes before clearing flag
      // AI : This prevents race conditions where the flag clears before async operations finish
      await nextTick();
      isSyncing = false;
    }
  });

  /**
   * AI : Watch mode and sync activeTab
   */
  watch(
    () => overlayStore.mode,
    (newMode) => {
      if (isSyncing) return;
      isSyncing = true;

      const newTab = modeToTab(newMode);
      if (initialTab.value !== newTab) {
        initialTab.value = newTab;
      }

      isSyncing = false;
    },
  );

  /**
   * AI : Watch for authentication changes and reset tab if user signs out
   */
  watch(
    () => authStore.isAuthenticated,
    (isAuthenticated) => {
      if (
        !isAuthenticated &&
        (initialTab.value === "uploads" || initialTab.value === "moderation")
      ) {
        initialTab.value = "latest";
      }
    },
  );

  /**
   * AI : Watch for moderation role changes and reset moderation tab if user loses rights
   */
  watch(
    () => authStore.isModerator,
    (isModerator) => {
      if (!isModerator && initialTab.value === "moderation") {
        initialTab.value = "latest";
      }
    },
  );

  /**
   * AI : Watch for overlay selection and auto-switch to Current City tab (only in view mode)
   * AI : Consolidated from SideMenu.vue and MobileDrawer.vue to avoid duplicate logic
   */
  const mapStore = useMapStore();
  watch(
    () => overlayStore.idSelectedOverlay,
    (overlayId) => {
      // AI : When an overlay is selected and we have a city loaded, switch to Current City tab
      // AI : Only do this in view mode - in edit/moderation modes, preserve the current workflow
      if (overlayId && mapStore.selectedCity && overlayStore.mode === "view") {
        initialTab.value = "currentCity";
      }
    },
  );

  return {
    authStore,
    tabToMode,
    modeToTab,
  };
}
