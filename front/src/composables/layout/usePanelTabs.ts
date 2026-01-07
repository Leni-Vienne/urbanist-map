import { watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { switchMode } from "@/composables/overlay/useModeSwitching";
import type { MapMode } from "@shared/types";
import type { PanelTab } from "@/types";

/**
 * AI : Map tab to overlay mode
 */
function tabToMode(tab: PanelTab): MapMode {
  switch (tab) {
    case "latest":
    case "currentLocation":
      // AI : View tabs always show view mode (approved overlays only)
      return "view";
    case "uploads":
      return "edit";
    case "moderation":
      return "moderation";
  }
}

/**
 * AI : Map overlay mode to tab
 * AI : Returns the default tab for a given mode
 */
function modeToDefaultTab(mode: MapMode): PanelTab {
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
 * AI : Uses explicit actions instead of fragile watcher cascades
 */
export function usePanelTabs() {
  const authStore = useAuthStore();
  const overlayStore = useOverlayStore();
  const uiStore = useUiStore();
  const mapStore = useMapStore();

  /**
   * AI : Explicit action to change the active tab
   * AI : Syncs the appropriate map mode automatically
   */
  function setActiveTab(newTab: PanelTab) {
    // 1. Update UI state immediately
    uiStore.setActiveTab(newTab);

    // 2. Determine target mode
    const targetMode = tabToMode(newTab);

    // 3. Sync map mode if needed
    if (overlayStore.mode !== targetMode) {
      switchMode(targetMode);
    }
  }

  /**
   * AI : Explicit action to change the map mode
   * AI : Syncs the appropriate tab automatically
   */
  function setMapMode(newMode: MapMode) {
    // 1. Sync map mode is handled by component calling this (usually via switchMode direct call)
    // but explicit call here would be redundant if called from ModeControls which calls switchMode.

    // AI : Logic to determine which tab to switch to
    let targetTab: PanelTab;

    if (newMode === "view") {
      // AI : Smart switch for View Mode
      if (uiStore.activeTab === "currentLocation" || uiStore.activeTab === "latest") {
        // AI : Already in a view-compatible tab, don't change it!
        return;
      }
      // AI : Prefer Current Location if a country OR city is selected, otherwise Latest
      targetTab =
        mapStore.selectedCity || mapStore.selectedCountryCode ? "currentLocation" : "latest";
    } else {
      // AI : For Edit/Moderation, use fixed mapping
      targetTab = modeToDefaultTab(newMode);
    }

    // 2. Update UI state if different
    if (uiStore.activeTab !== targetTab) {
      uiStore.setActiveTab(targetTab);
    }
  }

  /**
   * AI : Watch for map mode changes from other sources (e.g. ModeControls)
   * AI : This ensures Tabs update even if mode is changed via map buttons
   */
  watch(
    () => overlayStore.mode,
    (newMode) => {
      // AI : We still need to react to external mode changes,
      // but we use the smart logic in setMapMode to avoid overwriting "Current City"
      setMapMode(newMode);
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
        (uiStore.activeTab === "uploads" || uiStore.activeTab === "moderation")
      ) {
        setActiveTab("latest");
      }
    },
  );

  /**
   * AI : Watch for moderation role changes and reset moderation tab if user loses rights
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
   * AI : Watch for overlay selection and auto-switch to Current City tab (only in view mode)
   */
  watch(
    () => overlayStore.idSelectedOverlay,
    (overlayId) => {
      if (overlayId && mapStore.selectedCity && overlayStore.mode === "view") {
        // AI : Explicitly switch to Current City tab
        // AI : No need to call setActiveTab (which triggers switchMode) because we are already in view mode
        // AI : But for consistency we can use uiStore directly or our action
        if (uiStore.activeTab !== "currentLocation") {
          uiStore.setActiveTab("currentLocation");
        }
      }
    },
  );

  /**
   * AI : Watch for city selection and auto-switch to Current Location tab (only in view mode)
   * AI : This handles standalone project navigation from Latest Contributions panel
   * AI : Previously only overlays triggered tab switch via idSelectedOverlay watcher
   */
  watch(
    () => mapStore.selectedCity,
    (selectedCity, previousCity) => {
      // AI : Only switch tab if a new city is selected (not on clear)
      // AI : and we're in view mode on a tab that should switch (latest)
      if (
        selectedCity &&
        overlayStore.mode === "view" &&
        uiStore.activeTab === "latest" &&
        selectedCity.id !== previousCity?.id
      ) {
        uiStore.setActiveTab("currentLocation");
      }
    },
  );

  return {
    authStore,
    setActiveTab,
    // AI : Expose internal helpers if needed, but primary interface is setActiveTab
  };
}
