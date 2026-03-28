import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { AppMode } from "@shared/types";

export const useMapStore = defineStore("map", () => {
  // App mode (view, edit, moderation)
  const mode = ref<AppMode>("view");

  function setMode(newMode: AppMode) {
    if (mode.value === newMode) return;
    mode.value = newMode;
  }

  function resetMode() {
    mode.value = "view";
  }

  // Currently selected country code (set when switching countries)
  const selectedCountryCode = ref<string | null>(null);

  return {
    // State
    mode,
    selectedCountryCode,

    // Actions
    setMode,
    resetMode,
  };
});

// Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMapStore, import.meta.hot));
}
