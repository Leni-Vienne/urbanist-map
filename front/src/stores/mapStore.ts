import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import type { AppMode } from "@shared/types";
import type { PanelTab } from "@/types/index";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useModerationStore } from "@/stores/moderationStore";

// The active panel tab is the single source of truth; the map mode is derived from it.
// view is reachable from two tabs (latest, currentLocation), so mode is a function of
// tab but tab is not a function of mode, which is why tab has to be the source.
function tabToMode(tab: PanelTab): AppMode {
  switch (tab) {
    case "latest":
    case "currentLocation":
    case "filter":
      return "view";
    case "contribute":
      return "edit";
    case "moderation":
      return "moderation";
    default:
      // eslint-disable-next-line restrict-template-expressions
      throw new Error(`Unhandled tab: ${tab}`);
  }
}

export const useMapStore = defineStore("map", () => {
  const uiStore = useUiStore();
  const authStore = useAuthStore();

  const selectedCountryCode = ref<string | null>(null);

  // Single write path for the active country (exposed read-only below). The moderation list
  // is country-scoped, so any country change invalidates it; refetching is left to whoever
  // displays it (ModerationPanel refetches while mounted, or on its next mount).
  function setSelectedCountryCode(code: string | null) {
    if (selectedCountryCode.value === code) return;
    selectedCountryCode.value = code;
    useModerationStore().resetModerationLoaded();
  }

  // Derived, read-only. Edit and moderation require authentication, so an unauthenticated user
  // resting on either tab leaves the map in view mode. On sign-in the gate lifts and the mode
  // follows the tab automatically, no watcher needed.
  const mode = computed<AppMode>(() => {
    const target = tabToMode(uiStore.activeTab);
    if (target !== "view" && !authStore.isAuthenticated) return "view";
    return target;
  });

  // The tab a given mode lands on. view picks Current Location when a country is selected
  // (e.g. coming back from moderation), otherwise the Latest feed.
  function modeToTab(targetMode: AppMode): PanelTab {
    switch (targetMode) {
      case "view":
        return selectedCountryCode.value ? "currentLocation" : "latest";
      case "edit":
        return "contribute";
      case "moderation":
        return "moderation";
      default:
        // eslint-disable-next-line restrict-template-expressions
        throw new Error(`Unhandled mode: ${targetMode}`);
    }
  }

  // Switching mode is really navigation to that mode's tab. Already being in the target mode
  // (e.g. on either of the two view tabs) leaves the user where they are.
  function setMode(targetMode: AppMode) {
    if (mode.value === targetMode) return;
    uiStore.activeTab = modeToTab(targetMode);
  }

  function clearAllState() {
    selectedCountryCode.value = null;
  }

  return {
    mode,
    selectedCountryCode: computed(() => selectedCountryCode.value),
    setSelectedCountryCode,
    setMode,
    clearAllState,
  };
});

// Enable HMR for this store
// eslint-disable no-unnecessary-condition strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMapStore, import.meta.hot));
}
