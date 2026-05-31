import { watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import type { AppMode } from "@shared/types";
import type { PanelTab } from "@/types";

/**
 * Map sidemenu panel tabs to app mode
 */
function tabToMode(tab: PanelTab): AppMode {
  switch (tab) {
    case "latest":
    case "currentLocation":
      return "view";
    case "contribute":
      return "edit";
    case "moderation":
      return "moderation";
    default:
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unhandled tab: ${tab}`);
  }
}

/**
 * Map app mode to its default tab
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
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unhandled mode: ${mode}`);
  }
}

/**
 * Composable for managing panel tabs and mode synchronization.
 * Shared between SideMenu.vue and MobileDrawer.vue.
 */
export function usePanelTabs() {
  const authStore = useAuthStore();
  const overlayStore = useOverlayStore();
  const uiStore = useUiStore();
  const mapStore = useMapStore();

  /**
   * Change the active tab and sync the corresponding map mode.
   */
  function setActiveTab(newTab: PanelTab) {
    uiStore.activeTab = newTab;
    const targetMode = tabToMode(newTab);

    // Don't switch to edit mode for unauthenticated users, they see ContributeGuestPanel
    if (targetMode === "edit" && !authStore.isAuthenticated) return;
    mapStore.setMode(targetMode);
  }

  function computeTargetTab(newMode: AppMode): PanelTab {
    if (newMode === "view") {
      return mapStore.selectedCountryCode ? "currentLocation" : "latest";
    }
    return modeToDefaultTab(newMode);
  }

  /**
   * Change the map mode and sync the corresponding tab.
   */
  function setAppMode(newMode: AppMode) {
    if (
      newMode === "view" &&
      (uiStore.activeTab === "currentLocation" || uiStore.activeTab === "latest")
    ) {
      // Already on a view-compatible tab, leave it as-is
      return;
    }

    const targetTab = computeTargetTab(newMode);

    if (uiStore.activeTab !== targetTab) {
      uiStore.activeTab = targetTab;
    }
  }

  /**
   * React to mode changes triggered externally (e.g. ModeControls) and keep tabs in sync.
   */
  watch(
    () => mapStore.mode,
    (newMode) => {
      setAppMode(newMode);
    },
  );

  /**
   * Keep the map mode in sync with auth changes.
   * On sign-out: reset auth-only tabs to "latest".
   * On sign-in: re-apply the active tab's mode, since setActiveTab leaves the mode on
   * "view" for the contribute tab while unauthenticated (so the popup would still see
   * view mode after login until the mode is synced).
   */
  watch(
    () => authStore.isAuthenticated,
    (isAuthenticated) => {
      if (!isAuthenticated) {
        if (uiStore.activeTab === "contribute" || uiStore.activeTab === "moderation") {
          setActiveTab("latest");
        }
        return;
      }
      if (uiStore.activeTab === "contribute") {
        mapStore.setMode("edit");
      }
    },
  );

  /**
   * Reset moderation tab when the user loses moderator rights.
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
   * Auto-switch to the Current Location tab when an overlay is selected in view mode.
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
  };
}
