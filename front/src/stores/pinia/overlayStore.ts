import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { OverlayObject } from '@types';

export const useOverlayStore = defineStore('overlay', () => {
  // AI : Central store for overlay data to avoid circular dependencies
  const overlays = shallowRef<Record<string, OverlayObject>>({});
  const idSelectedOverlay = ref<string | null>(null);
  const isEditMode = ref(false);

  // AI : Replacement overlay functionality
  const replacementOverlayId = ref<string | null>(null);
  const showImageUploadDialog = ref(false);

  // AI : Request overlay replacement (replaces EventBus functionality)
  function requestOverlayReplacement(overlayId: string) {
    replacementOverlayId.value = overlayId;
    showImageUploadDialog.value = true;
  }

  // AI : Reset replacement state
  function resetReplacement() {
    replacementOverlayId.value = null;
  }

  return {
    // State
    overlays,
    idSelectedOverlay,
    isEditMode,
    replacementOverlayId,
    showImageUploadDialog,
    
    // Actions
    requestOverlayReplacement,
    resetReplacement
  };
});
