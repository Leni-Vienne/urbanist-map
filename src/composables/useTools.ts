import L from "leaflet";
import 'leaflet-toolbar';
import 'leaflet-distortableimage-updated';
import { type ComponentInternalInstance, createVNode, render } from 'vue';
import { map } from './useMap';
import { overlays, idSelectedOverlay, isEditMode } from './useOverlay';
import { undo, redo, resetImageRatio, toggleWhitePixels, deleteOverlay, updateOverlayInfo } from './useOverlayActions';
import InfoPopup from '../components/InfoPopup.vue';
import { useToast } from './useToast';
import type { ProjectInfo } from '../types';

const toast = useToast();

let appInstance: ComponentInternalInstance | null = null;

export function setAppContext(instance: ComponentInternalInstance) {
  appInstance = instance;
}

export const infoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: 'pi pi-info-circle',
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
    if (L.DomUtil.hasClass(link, "subtoolbar_enabled")) {
      L.DomUtil.removeClass(link, "subtoolbar_enabled");

      setTimeout(() => {
        this.options.subToolbar._hide();
      }, 100);

    } else {
      L.DomUtil.addClass(link, "subtoolbar_enabled");

      setTimeout(() => {
        if (!idSelectedOverlay.value) return;
        // no idea why but we need to get the element by its class name and not by its id
        const popupElement = document.getElementsByClassName("more-info-popup")[0];

        if (!popupElement || popupElement.tagName !== 'A') {
          return
        }
        const newDiv = document.createElement('div');
        newDiv.className = "leaflet-toolbar-icon more-info-popup";
        newDiv.id = "info-popup-container";
        if (popupElement.parentNode) {
          popupElement.parentNode.replaceChild(newDiv, popupElement);
        } else {
          return
        }

        const vnode = createVNode(InfoPopup, {
          overlayObject: overlays.value[idSelectedOverlay.value],
          onProjectSubmit: handleProjectSubmit,
          viewMode: !isEditMode.value
        })
        if (appInstance) {
          vnode.appContext = appInstance.appContext;
        }
        render(vnode, newDiv);
      }, 10);
    }

    (L as any).IconUtil.toggleXlink(link, "information", "close");
    (L as any).IconUtil.toggleTitle(link, "Close", "About");
  }
});

function handleProjectSubmit(projectInfo: ProjectInfo & { id: string }) {
  if (!projectInfo.id || !overlays.value[projectInfo.id]) {
    console.error('Overlay not found for ID:', projectInfo.id);
    return;
  }

  // Only pass the properties that are expected by updateOverlayInfo
  updateOverlayInfo(projectInfo.id, {});

  toast.add({ severity: 'success', summary: 'Project info updated', life: 3000 });

  // Close the info popup
  const infoLink = document.querySelector('.pi-info-circle');
  if (infoLink && infoLink instanceof HTMLElement) {
    infoLink.click();
  }
}

export const centerTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      html: '<span>Center Map</span>',
      tooltip: 'Center map on the selected overlay',
    },
  },
  addHooks: function () {
    if (!idSelectedOverlay.value) {
      alert('No overlay selected!');
      return;
    }
    const overlayObject = overlays.value[idSelectedOverlay.value];
    if (overlayObject && overlayObject.overlay) {
      const bounds = overlayObject.overlay.getBounds();
      map.value?.fitBounds(bounds);
    }
  },
});

export const undoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-undo",
      tooltip: 'Undo (control + z)',
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
      tooltip: 'Redo (control + y)',
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
      tooltip: 'Restore image ratio',
    },
  },
  addHooks: function () {
    resetImageRatio();
  },
});

export const backgroundTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-eraser",
      tooltip: 'Toggle the background',
    },
  },
  addHooks: function () {
    toggleWhitePixels();
  },
});

export const customDeleteTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-trash",
      tooltip: "Delete this overlay",
    },
  },
  addHooks: function () {
    if (!idSelectedOverlay.value) {
      return;
    }
    if (confirm('Are you sure you want to delete this overlay?')) {
      deleteOverlay(idSelectedOverlay.value);
      idSelectedOverlay.value = null;
    }
  },
});

// all actions (not all in docs) : L.DistortAction, L.FreeRotateAction, L.OpacityAction, L.DeleteAction, L.StackAction, L.EditAction, L.RotateAction, L.ScaleAction, L.TranslateAction, L.OpacitiesAction, L.GeolocateAction, L.RestoreAction, L.UnlockAction
// L.EditAction is empty
// L.TranslateAction crashes
// L.UnlockAction is useless
// L.GeolocateAction crashes "ReferenceError: EXIF is not defined"
// L.RestoreAction undistorts the image, centers it on the camera and size it to an arbitrary size. Not great
// L.OpacitiesAction works well!
export const editTools = [
  undoTool,
  redoTool,
  resetRatioTool,
  backgroundTool,
  L.DistortAction,
  L.RotateAction,
  L.FreeRotateAction,
  L.OpacityAction,
  L.OpacitiesAction,
  customDeleteTool,
  L.StackAction
];

export const viewTools = [
  centerTool,
  backgroundTool,
  L.OpacityAction,
  L.OpacitiesAction,
  L.StackAction
];