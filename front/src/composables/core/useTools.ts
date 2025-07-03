import L from "leaflet";

import { type ComponentInternalInstance, createVNode, render } from 'vue';
import { map } from '@composables/core/useMap';
import { overlays, idSelectedOverlay, isEditMode } from '@composables/overlay/useOverlay';
import { undo, redo, resetImageRatio, toggleWhitePixels, deleteOverlay, updateOverlayInfo, goToNextOverlay, goToPreviousOverlay } from '@composables/overlay/useOverlayActions';
import InfoPopup from '@components/map/InfoPopup.vue';
import { useToast } from '@composables/ui/useToast';
import type { ProjectInfo } from '@types';
import { router } from '../../router';

const toast = useToast();

let appInstance: ComponentInternalInstance | null = null;
let appGlobalProperties: any = null;

export function setAppContext(instance: ComponentInternalInstance) {
  appInstance = instance;

  try {
    // AI : Store the entire globalProperties object to ensure we have access to everything
    appGlobalProperties = instance.appContext.config.globalProperties;
  } catch (err) {
    console.error('AI: Failed to store app context', err);
  }
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
        }        const vnode = createVNode(InfoPopup, {
          overlayObject: overlays.value[idSelectedOverlay.value],
          onProjectSubmit: handleProjectSubmit,
          viewMode: !isEditMode.value
        })

        // AI : Use the main app instance to ensure proper PrimeVue context
        if (window.vueApp?._context) {
          vnode.appContext = window.vueApp._context;
        } else if (appInstance) {
          // AI : Fallback to component instance context if main app not available
          vnode.appContext = { ...appInstance.appContext };

          // AI : Ensure the provides object exists
          vnode.appContext.provides ??= {};

          // AI : Explicitly provide router
          vnode.appContext.provides[Symbol.for('router')] = router;

          // AI : Ensure global properties are available
          if (appGlobalProperties) {
            vnode.appContext.config.globalProperties = {
              ...vnode.appContext.config.globalProperties,
              ...appGlobalProperties
            };
          }
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

  updateOverlayInfo(projectInfo.id, {});

  toast.add({ severity: 'success', summary: 'Project info updated', life: 3000 });

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
    if (overlayObject?.overlay) {
      const bounds = overlayObject.overlay.getBounds();
      map.value?.fitBounds(bounds);
    }
  },
});

export const previousOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-arrow-left",
      tooltip: 'Go to previous overlay',
    },
  },
  addHooks: function () {
    goToPreviousOverlay();
  },
});

export const nextOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-arrow-right",
      tooltip: 'Go to next overlay',
    },
  },
  addHooks: function () {
    goToNextOverlay();
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
      tooltip: "Delete this overlay from local storage",
    },
  },
  addHooks: function () {
    if (!idSelectedOverlay.value) {
      return;
    }
    if (confirm('Are you sure you want to delete this overlay from local storage?')) {
      deleteOverlay(idSelectedOverlay.value);
      idSelectedOverlay.value = null;
    }
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
  undoTool,
  redoTool,
  L.DragAction,
  L.ResizeRotateAction,
  L.DistortAction,
  resetRatioTool,
  backgroundTool,
  L.OpacityAction,
  L.OpacitiesAction,
  previousOverlayTool,
  nextOverlayTool,
  L.StackAction,
  customDeleteTool,
];

export const viewTools = [
  centerTool,
  backgroundTool,
  L.OpacityAction,
  L.OpacitiesAction,
  previousOverlayTool,
  nextOverlayTool,
  L.StackAction
];