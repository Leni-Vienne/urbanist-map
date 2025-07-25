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

  // AI : InfoPopup state for Teleport solution
  const showInfoPopup = ref(false);
  const infoPopupOverlayId = ref<string | null>(null);

  // AI : Request overlay replacement (replaces EventBus functionality)
  function requestOverlayReplacement(overlayId: string) {
    replacementOverlayId.value = overlayId;
    showImageUploadDialog.value = true;
  }

  // AI : Reset replacement state
  function resetReplacement() {
    replacementOverlayId.value = null;
  }

  // AI : Show InfoPopup for specific overlay
  function showInfoPopupForOverlay(overlayId: string) {
    infoPopupOverlayId.value = overlayId;
    showInfoPopup.value = true;
  }

  // AI : Hide InfoPopup
  function hideInfoPopup() {
    showInfoPopup.value = false;
    infoPopupOverlayId.value = null;
  }

  // AI : Toggle InfoPopup for selected overlay
  function toggleInfoPopup() {
    if (showInfoPopup.value) {
      hideInfoPopup();
    } else if (idSelectedOverlay.value) {
      showInfoPopupForOverlay(idSelectedOverlay.value);
    }
  }

  // AI : Reset all UI states (useful when overlays are recreated)
  function resetAllUIStates() {
    hideInfoPopup();
    resetReplacement();
    // AI : Clean up any lingering DOM elements
    const existingTargets = document.querySelectorAll('#info-popup-teleport-target');
    existingTargets.forEach(target => target.remove());
    
    // AI : Reset any toolbar states
    const toolbarButtons = document.querySelectorAll('.leaflet-toolbar .subtoolbar_enabled');
    toolbarButtons.forEach(button => {
      if (button.classList.contains('pi-info-circle')) {
        button.classList.remove('subtoolbar_enabled');
      }
    });
  }

  // AI : Close all UI elements gracefully (useful for window blur events)
  function closeAllUIElements() {
    hideInfoPopup();
    resetReplacement();
    
    // AI : Clean up any lingering DOM elements
    const existingTargets = document.querySelectorAll('#info-popup-teleport-target');
    existingTargets.forEach(target => target.remove());
    
    // AI : Reset any toolbar states
    const toolbarButtons = document.querySelectorAll('.leaflet-toolbar .subtoolbar_enabled');
    toolbarButtons.forEach(button => {
      if (button.classList.contains('pi-info-circle')) {
        button.classList.remove('subtoolbar_enabled');
      }
    });
  }

  return {
    // State
    overlays,
    idSelectedOverlay,
    isEditMode,
    replacementOverlayId,
    showImageUploadDialog,
    showInfoPopup,
    infoPopupOverlayId,
    
    // Actions
    requestOverlayReplacement,
    resetReplacement,
    showInfoPopupForOverlay,
    hideInfoPopup,
    toggleInfoPopup,
    resetAllUIStates,
    closeAllUIElements
  };
});
