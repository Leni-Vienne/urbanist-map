import L from "leaflet";

import { undo, redo, resetImageRatio, deleteOverlay, goToNextOverlay, goToPreviousOverlay } from '@composables/overlay/useOverlayActions';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { storeToRefs } from 'pinia';

// AI : Function to get store refs when needed
function getStoreRefs() {
  const overlayStore = useOverlayStore();
  const { overlays, idSelectedOverlay, isEditMode } = storeToRefs(overlayStore);
  return { overlays, idSelectedOverlay, isEditMode };
}

export const infoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: 'pi pi-info-circle',
      tooltip: 'Info'
    },
    subToolbar: new L.Toolbar2({
      actions: [L.EditAction.extend({
        options: {
          toolbarIcon: {
            tooltip: "Info",
            className: "more-info-popup",
          },
        },
        initialize: function () {
          L.EditAction.prototype.initialize.apply(this, arguments);
        }
      })],
    })
  },
  addHooks() {
    const link = this._link;
    const overlayStore = useOverlayStore();
    const { idSelectedOverlay } = getStoreRefs();

    if (!idSelectedOverlay.value) {
      return;
    }

    // AI : Check if currently open using store state
    const isCurrentlyOpen = overlayStore.showInfoPopup;

    if (isCurrentlyOpen) {
      // AI : Close
      overlayStore.hideInfoPopup();
      L.DomUtil.removeClass(link, "subtoolbar_enabled");
      this.options.subToolbar._hide();
      // AI : Restore the original button when closing
      const teleportTarget = document.getElementById('info-popup-teleport-target');
      if (teleportTarget && teleportTarget.parentNode) {
        const originalButton = document.createElement('a');
        originalButton.className = "leaflet-toolbar-icon more-info-popup";
        originalButton.href = "#";
        originalButton.title = "Info";
        originalButton.setAttribute('role', 'button');

        teleportTarget.parentNode.replaceChild(originalButton, teleportTarget);
      }
    } else {
      // AI : Open
      L.DomUtil.addClass(link, "subtoolbar_enabled");
      this.options.subToolbar._show();

      const subtoolbarContainer = this.options.subToolbar._container;
      const existingButton = subtoolbarContainer?.querySelector('.more-info-popup');

      if (existingButton && existingButton.tagName === 'A') {
        const teleportTarget = document.createElement('div');
        teleportTarget.id = "info-popup-teleport-target";
        teleportTarget.className = "leaflet-toolbar-icon more-info-popup";

        existingButton.parentNode?.replaceChild(teleportTarget, existingButton);

        if (idSelectedOverlay.value) {
          overlayStore.showInfoPopupForOverlay(idSelectedOverlay.value);
        }
      }
    }

    (L as any).IconUtil.toggleXlink(link, "information", "close");
    (L as any).IconUtil.toggleTitle(link, "Close", "About");
  }
});

export const previousOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-arrow-left",
      tooltip: 'Go to previous overlay',
    },
  },
  addHooks: async function () {
    await goToPreviousOverlay();
  },
});

export const nextOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-arrow-right",
      tooltip: 'Go to next overlay',
    },
  },
  addHooks: async function () {
    await goToNextOverlay();
  },
});

export const undoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-undo",
      tooltip: 'Undo (ctrl + z)',
    },
  },
  addHooks: function () {
    undo();
  },
});

export const redoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-refresh",
      tooltip: 'Redo (ctrl + y)',
    },
  },
  addHooks: function () {
    redo();
  },
});

export const resetRatioTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-arrow-up-right-and-arrow-down-left-from-center",
      tooltip: 'Restore and mirror image',
    },
  },
  addHooks: function () {
    resetImageRatio();
  },
});

export const customDeleteTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-trash",
      tooltip: "Delete this overlay from local storage",
    },
  },
  addHooks: function () {
    const { idSelectedOverlay } = getStoreRefs();
    if (!idSelectedOverlay.value) {
      return;
    }
    if (confirm('Are you sure you want to delete this overlay from local storage?')) {
      deleteOverlay(idSelectedOverlay.value);
      idSelectedOverlay.value = null;
    }
  },
});

export const replaceOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-image",
      tooltip: "Replace this overlay image",
    },
  },
  addHooks: async function () {
    const { idSelectedOverlay } = getStoreRefs();
    if (!idSelectedOverlay.value) {
      return;
    }

    // AI : Use the overlay store for replacement functionality
    const overlayStore = useOverlayStore();

    // AI : Request overlay replacement using the store
    overlayStore.requestOverlayReplacement(idSelectedOverlay.value);
  },
});

// all actions (not all in docs) : L.DistortAction, L.FreeRotateAction, L.OpacityAction, L.DeleteAction, L.StackAction, L.EditAction, L.RotateAction, L.ScaleAction, L.TranslateAction, L.OpacitiesAction, L.GeolocateAction, L.RestoreAction, L.UnlockAction
// L.RotateAction,
// L.EditAction is empty
// L.TranslateAction
// L.UnlockAction is useless
// L.LockAction
// L.GeolocateAction crashes "ReferenceError: EXIF is not defined"
// L.RestoreAction undistorts the image, centers it on the camera and size it to an arbitrary size. Not great
// L.OpacitiesAction works well!
// L.BorderAction
// L.DragAction
// L.ExportAction
// L.ResizeRotateAction
// L.TransformAction
// L.ScaleAction


export const editTools = [
  infoTool,
  undoTool,
  redoTool,
  L.DragAction,
  L.ResizeRotateAction,
  L.DistortAction,
  resetRatioTool,
  L.OpacityAction,
  L.OpacitiesAction,
  previousOverlayTool,
  nextOverlayTool,
  L.StackAction,
  replaceOverlayTool,
  customDeleteTool,
];

export const viewTools = [
  infoTool,
  L.OpacityAction,
  L.OpacitiesAction,
  previousOverlayTool,
  nextOverlayTool,
  L.StackAction
];