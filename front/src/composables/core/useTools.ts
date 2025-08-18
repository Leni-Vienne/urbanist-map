import L from "leaflet";

import { undo, redo, resetImageRatio, deleteOverlay, goToNextOverlay, goToPreviousOverlay } from '@composables/overlay/useOverlayActions';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { storeToRefs } from 'pinia';

// AI : Function to get store refs directly from the store
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

    // AI : Check if currently open using store state and DOM state
    const { showInfoPopup } = storeToRefs(overlayStore);
    const teleportTargetExists = !!this.options.subToolbar._container?.querySelector('#info-popup-teleport-target');
    const isCurrentlyOpen = showInfoPopup.value && teleportTargetExists;

    // IMPORTANT : This if/else is need to toggle open/close the info popup and be able to open it again
    if (isCurrentlyOpen) {
      // AI : Close
      overlayStore.hideInfoPopup();
      this.options.subToolbar._hide();

      // AI : Remove the teleport target and restore original button
      const teleportTarget = this.options.subToolbar._container?.querySelector('#info-popup-teleport-target');
      if (teleportTarget?.parentNode) {
        const originalButton = document.createElement('a');
        originalButton.className = "leaflet-toolbar-icon more-info-popup";
        originalButton.href = "#";
        originalButton.title = "Info";
        originalButton.setAttribute('role', 'button');

        teleportTarget.parentNode.replaceChild(originalButton, teleportTarget);
      }
    } else {
      // AI : Open - but first clean up any stale teleport target
      if (teleportTargetExists && !showInfoPopup.value) {
        // AI : Store thinks popup is closed but DOM has teleport target - clean it up
        const staleTarget = this.options.subToolbar._container?.querySelector('#info-popup-teleport-target');
        if (staleTarget?.parentNode) {
          const originalButton = document.createElement('a');
          originalButton.className = "leaflet-toolbar-icon more-info-popup";
          originalButton.href = "#";
          originalButton.title = "Info";
          originalButton.setAttribute('role', 'button');
          staleTarget.parentNode.replaceChild(originalButton, staleTarget);
        }
      }

      this.options.subToolbar._show();

      // AI : Wait for subtoolbar to be shown before manipulating it
      const existingButton = this.options.subToolbar._container?.querySelector('.more-info-popup');

      if (existingButton?.tagName === 'A') {
        const teleportTarget = document.createElement('div');
        teleportTarget.id = "info-popup-teleport-target";
        // AI : Ensure teleport target doesn't interfere with map interactions
        teleportTarget.style.cssText = 'pointer-events: none; position: absolute; width: 0; height: 0; overflow: visible;';

        existingButton.parentNode?.replaceChild(teleportTarget, existingButton);

        // AI : Show the info popup for the selected overlay
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

export const mirrorResetTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      html: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0078a8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 7 5 5-5 5V7" /><path d="m21 7-5 5 5 5V7" /><path d="M12 20v2" /><path d="M12 14v2" /><path d="M12 8v2" /><path d="M12 2v2" /></svg>',
      tooltip: 'Mirror and reset Image',
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
  mirrorResetTool,
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
