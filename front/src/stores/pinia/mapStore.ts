import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { AppMode } from "@shared/types";

export const useMapStore = defineStore("map", () => {
  const mode = ref<AppMode>("view");

  function setMode(newMode: AppMode) {
    if (mode.value === newMode) return;
    mode.value = newMode;
  }

  const selectedCountryCode = ref<string | null>(null);

  function clearAllState() {
    mode.value = "view";
    selectedCountryCode.value = null;
  }

  return {
    mode,
    selectedCountryCode,
    setMode,
    clearAllState,
  };
});

// Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMapStore, import.meta.hot));
}
