import { watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import type { AppMode } from "@shared/types";
import type { PanelTab } from "@/types";

/**
 * Map sidemenu panels/tabs to app mode
 */
function tabToMode(tab: PanelTab): AppMode {
  switch (tab) {
    case "latest":
    case "currentLocation":
      // View tabs always show view mode (approved overlays only)
      return "view";
    case "contribute":
      return "edit";
    case "moderation":
      return "moderation";
    default:
      // Exhaustiveness check — all PanelTab values must be handled above
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unhandled tab: ${tab}`);
  }
}

/**
 * Map overlay mode to tab
 * Returns the default tab for a given mode
 */
function modeToDefaultTab(mode: AppMode): PanelTab {
  switch (mode) {
    case "view":
      return "latest";
    case "edit":
      return "contribute";
    case "moderation":
      return "moderation";
    default:
      // Exhaustiveness check — all AppMode values must be handled above
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unhandled mode: ${mode}`);
  }
}

/**
 * Composable for managing panel tabs and mode synchronization
 * Shared between SideMenu.vue and MobileDrawer.vue
 * Uses explicit actions instead of fragile watcher cascades
 */
export function usePanelTabs() {
  const authStore = useAuthStore();
  const overlayStore = useOverlayStore();
  const uiStore = useUiStore();
  const mapStore = useMapStore();

  /**
   * Explicit action to change the active tab
   * Syncs the appropriate map mode automatically
   */
  function setActiveTab(newTab: PanelTab) {
    // 1. Update UI state immediately
    uiStore.activeTab = newTab;

    // 2. Determine target mode
    const targetMode = tabToMode(newTab);

    // 3. Sync map mode if needed
    // Skip edit-mode switch for unauthenticated users — they see ContributeGuestPanel
    // which doesn't use edit mode, and switching would eagerly load overlay editing chunks.
    if (targetMode === "edit" && !authStore.isAuthenticated) return;
    mapStore.setMode(targetMode);
  }

  /**
   * Explicit action to change the map mode
   * Syncs the appropriate tab automatically
   */
  function setAppMode(newMode: AppMode) {
    // 1. Sync map mode is handled by component calling this (usually via switchMode direct call)
    // but explicit call here would be redundant if called from ModeControls which calls switchMode.

    // Logic to determine which tab to switch to
    let targetTab: PanelTab;

    if (newMode === "view") {
      // Smart switch for View Mode
      if (uiStore.activeTab === "currentLocation" || uiStore.activeTab === "latest") {
        // Already in a view-compatible tab, don't change it!
        return;
      }
      // Prefer Current Location if a country is selected, otherwise Latest
      targetTab = mapStore.selectedCountryCode ? "currentLocation" : "latest";
    } else {
      // For Edit/Moderation, use fixed mapping
      targetTab = modeToDefaultTab(newMode);
    }

    // 2. Update UI state if different
    if (uiStore.activeTab !== targetTab) {
      uiStore.activeTab = targetTab;
    }
  }

  /**
   * Watch for map mode changes from other sources (e.g. ModeControls)
   * This ensures Tabs update even if mode is changed via map buttons
   */
  watch(
    () => mapStore.mode,
    (newMode) => {
      // We still need to react to external mode changes,
      // but we use the smart logic in setAppMode to avoid overwriting "Current City"
      setAppMode(newMode);
    },
  );

  /**
   * Watch for authentication changes and reset tab if user signs out
   */
  watch(
    () => authStore.isAuthenticated,
    (isAuthenticated) => {
      if (
        !isAuthenticated &&
        (uiStore.activeTab === "contribute" || uiStore.activeTab === "moderation")
      ) {
        setActiveTab("latest");
      }
    },
  );

  /**
   * Watch for moderation role changes and reset moderation tab if user loses rights
   */
  watch(
    () => authStore.isModerator,
    (isModerator) => {
      if (!isModerator && uiStore.activeTab === "moderation") {
        setActiveTab("latest");
      }
    },
  );

  /**
   * Watch for overlay selection and auto-switch to Current Location tab (only in view mode)
   */
  watch(
    () => overlayStore.idSelectedOverlay,
    (overlayId) => {
      if (overlayId && mapStore.mode === "view") {
        if (uiStore.activeTab !== "currentLocation") {
          uiStore.activeTab = "currentLocation";
        }
      }
    },
  );

  return {
    authStore,
    setActiveTab,
    // Expose internal helpers if needed, but primary interface is setActiveTab
  };
}
