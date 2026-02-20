// AI : Leaflet toolbar tool definitions for overlay editing
// AI : Extracted from useOverlay.ts to reduce file complexity
// AI : Contains all toolbar actions for both edit and view modes

import L from "leaflet";
import "leaflet-toolbar";
import { t } from "@/locales";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { useToast } from "@/composables/ui/useToast";
import { setOverlayPopupTarget } from "@/services/map/popupState";
import { withErrorHandling } from "@/services/core/errorHandling";
import { deleteOverlayDirect } from "@/services/core/entityRemoval";
import type { OverlayObject } from "@/types/index";
import { map } from "@/services/core/map";
import { saveToHistory } from "@/services/overlay/overlayHistory";
import { updateMarkerPosition } from "@/services/overlay/overlayMarkers";

/**
 * AI : Callback registry for toolbar actions
 * AI : This avoids circular dependencies by allowing useOverlay.ts to register its functions
 * AI : after both modules are loaded
 */
const toolbarCallbacks = {
  focusCameraToOverlay: null as ((direction: "next" | "previous") => void) | null,
  undo: null as (() => void) | null,
  redo: null as (() => void) | null,
};

/**
 * AI : Register callbacks from useOverlay.ts
 * AI : Called by useOverlay.ts after it's loaded to provide the functions
 */
export function registerToolbarCallbacks(callbacks: {
  focusCameraToOverlay: (direction: "next" | "previous") => void;
  undo: () => void;
  redo: () => void;
}) {
  Object.assign(toolbarCallbacks, callbacks);
}

/**
 * AI : Check if user can delete an overlay
 * AI : Only allow deletion if:
 * 1. Overlay is pending or rejected (not yet approved)
 * 2. Overlay is a brand new local overlay (no status, not saved remotely)
 * AI : Never allow deletion of approved overlays, even with local modifications
 */
function canDeleteOverlay(overlayObject: OverlayObject): boolean {
  // AI : Never allow deletion of approved overlays, even with local modifications
  // AI : Local modifications to approved overlays should be submitted as changes, not deleted
  if (overlayObject.status === "approved") {
    return false;
  }

  // AI : Allow deletion of pending overlays (awaiting moderation)
  if (overlayObject.status === "pending" || overlayObject.status === "rejected") {
    return true;
  }

  // AI : Allow deletion of brand new local overlays (no status, isModified = true)
  // AI : This covers overlays created locally that haven't been submitted yet
  if (overlayObject.isModified) {
    return true;
  }

  return false;
}

/**
 * AI : Info tool - Opens overlay info popup
 * AI : Lazy initialization to avoid module load timing issues
 */
let _infoTool: any = null;
function getInfoTool() {
  if (_infoTool) return _infoTool;

  _infoTool = L.Toolbar2.Action.extend({
    options: {
      toolbarIcon: {
        className: "pi pi-ellipsis-v",
        tooltip: "", // AI : Will be set in initialize
      },
      subToolbar: new L.Toolbar2({
        actions: [
          L.Toolbar2.Action.extend({
            options: {
              toolbarIcon: {
                tooltip: "", // AI : Will be set in initialize
                className: "more-info-popup",
              },
            },
            initialize: function initialize() {
              // AI : Set tooltip dynamically after i18n is ready
              this.options.toolbarIcon.tooltip = t("toolbar.info");
              L.Toolbar2.Action.prototype.initialize?.apply(this, [...arguments]);
            },
          }),
        ],
      }),
    },
    initialize: function initialize() {
      // AI : Set tooltip dynamically after i18n is ready
      this.options.toolbarIcon.tooltip = t("toolbar.info");
      L.Toolbar2.Action.prototype.initialize?.apply(this, [...arguments]);
    },
    // very fragile code but necessary to plug into the leaflet toolbar. If you have a better idea, please contribute!
    addHooks() {
      const overlayStore = useOverlayStore();
      const uiStore = useUiStore();

      if (!overlayStore.idSelectedOverlay) {
        return;
      }

      // AI : Check if currently open using store state and DOM state
      const teleportTargetExists = Boolean(
        this.options.subToolbar._container?.querySelector("#info-popup-teleport-target"),
      );
      const isCurrentlyOpen = overlayStore.showInfoPopup && teleportTargetExists;

      // IMPORTANT : This if/else is need to toggle open/close the info popup and be able to open it again
      if (isCurrentlyOpen) {
        // AI : Close - but don't call _hide() as it breaks parent toolbar event handlers (MAYBE)
        overlayStore.hideInfoPopup();

        // AI : Remove the teleport target and restore original button
        const teleportTarget = this.options.subToolbar._container?.querySelector(
          "#info-popup-teleport-target",
        );
        if (teleportTarget?.parentNode) {
          // AI : Clear reactive state
          setOverlayPopupTarget(null);

          const originalButton = document.createElement("a");
          originalButton.className = "leaflet-toolbar-icon more-info-popup";
          originalButton.href = "#";
          originalButton.title = "Info";
          originalButton.setAttribute("role", "button");

          teleportTarget.parentNode.replaceChild(originalButton, teleportTarget);
        }
      } else {
        // AI : Open - but first clean up any stale teleport target
        if (teleportTargetExists && !overlayStore.showInfoPopup) {
          // AI : Store thinks popup is closed but DOM has teleport target - clean it up
          const staleTarget = this.options.subToolbar._container?.querySelector(
            "#info-popup-teleport-target",
          );
          if (staleTarget?.parentNode) {
            // AI : Clear reactive state
            setOverlayPopupTarget(null);

            const originalButton = document.createElement("a");
            originalButton.className = "leaflet-toolbar-icon more-info-popup";
            originalButton.href = "#";
            originalButton.title = t("toolbar.info");
            originalButton.setAttribute("role", "button");
            staleTarget.parentNode.replaceChild(originalButton, staleTarget);
          }
        }

        this.options.subToolbar._show();

        // AI : Wait for subtoolbar to be shown before manipulating it
        const existingButton =
          this.options.subToolbar._container?.querySelector(".more-info-popup");

        if (existingButton?.tagName === "A") {
          const teleportTarget = document.createElement("div");
          teleportTarget.id = "info-popup-teleport-target";
          // AI : Ensure teleport target doesn't interfere with map interactions
          teleportTarget.style.cssText =
            "pointer-events: none; position: absolute; width: 0; height: 0; overflow: visible;";

          existingButton.parentNode?.replaceChild(teleportTarget, existingButton);

          // AI : Set reactive state
          setOverlayPopupTarget(teleportTarget);

          // AI : Show the info popup for the selected overlay
          if (overlayStore.idSelectedOverlay) {
            // AI : Close project popup if it's open (only one popup at a time)
            if (uiStore.projectInfoPopup.visible) {
              uiStore.closeProjectInfoPopup();
            }
            overlayStore.showInfoPopupForOverlay(overlayStore.idSelectedOverlay);
          }
        }
      }
    },
  });

  return _infoTool;
}

/**
 * AI : Previous overlay tool - Navigate to previous overlay in project
 */
const previousOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-arrow-left",
      tooltip: "", // AI : Will be set in initialize
    },
  },
  initialize: function initialize() {
    // AI : Set tooltip dynamically after i18n is ready
    this.options.toolbarIcon.tooltip = t("toolbar.previousOverlay");
    L.Toolbar2.Action.prototype.initialize?.apply(this, [...arguments]);
  },
  addHooks: function addHooks() {
    toolbarCallbacks.focusCameraToOverlay?.("previous");
  },
});

/**
 * AI : Next overlay tool - Navigate to next overlay in project
 */
const nextOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-arrow-right",
      tooltip: "", // AI : Will be set in initialize
    },
  },
  initialize: function initialize() {
    // AI : Set tooltip dynamically after i18n is ready
    this.options.toolbarIcon.tooltip = t("toolbar.nextOverlay");
    L.Toolbar2.Action.prototype.initialize?.apply(this, [...arguments]);
  },
  addHooks: function addHooks() {
    toolbarCallbacks.focusCameraToOverlay?.("next");
  },
});

/**
 * AI : Undo tool - Undo last overlay modification
 */
const undoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-undo",
      tooltip: "", // AI : Will be set in initialize
    },
  },
  initialize: function initialize() {
    // AI : Set tooltip dynamically after i18n is ready
    this.options.toolbarIcon.tooltip = t("toolbar.undo");
    L.Toolbar2.Action.prototype.initialize?.apply(this, [...arguments]);
  },
  addHooks: function addHooks() {
    toolbarCallbacks.undo?.();
  },
});

/**
 * AI : Redo tool - Redo last undone modification
 */
const redoTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-refresh",
      tooltip: "", // AI : Will be set in initialize
    },
  },
  initialize: function initialize() {
    // AI : Set tooltip dynamically after i18n is ready
    this.options.toolbarIcon.tooltip = t("toolbar.redo");
    L.Toolbar2.Action.prototype.initialize?.apply(this, [...arguments]);
  },
  addHooks: function addHooks() {
    toolbarCallbacks.redo?.();
  },
});

/**
 * AI : Reset ratio tool - Reset overlay to original image aspect ratio
 */
const resetRatioTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      html: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0078a8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-move-diagonal-icon lucide-move-diagonal"><path d="M11 19H5v-6"/><path d="M13 5h6v6"/><path d="M19 5 5 19"/></svg>',
      tooltip: "", // AI : Will be set in initialize
    },
  },
  initialize: function initialize() {
    // AI : Set tooltip dynamically after i18n is ready
    this.options.toolbarIcon.tooltip = t("toolbar.resetRatio");
    L.Toolbar2.Action.prototype.initialize?.apply(this, [...arguments]);
  },
  addHooks: function addHooks() {
    resetImageRatio();
  },
});

interface CornersInfo {
  centerPoint: L.Point;
  angleRad: number;
}

interface Dimensions {
  width: number;
  height: number;
}

function calculateRatioFixParameters(
  originalRatio: number,
  currentCorners: { lat: number; lng: number }[],
) {
  // AI : Convert corners to screen coordinates
  const nw = map.value.latLngToContainerPoint(currentCorners[0]!);
  const ne = map.value.latLngToContainerPoint(currentCorners[1]!);
  const sw = map.value.latLngToContainerPoint(currentCorners[2]!);
  const se = map.value.latLngToContainerPoint(currentCorners[3]!);

  // AI : Calculate current dimensions by averaging opposite edges
  const topEdge = nw.distanceTo(ne);
  const rightEdge = ne.distanceTo(se);
  const bottomEdge = sw.distanceTo(se);
  const leftEdge = nw.distanceTo(sw);

  const currentWidth = (topEdge + bottomEdge) / 2;
  const currentHeight = (leftEdge + rightEdge) / 2;

  // AI : Calculate new dimensions that maintain original ratio
  let newWidth = 0;
  let newHeight = 0;
  if (currentWidth / currentHeight > originalRatio) {
    newHeight = currentHeight;
    newWidth = currentHeight * originalRatio;
  } else {
    newWidth = currentWidth;
    newHeight = currentWidth / originalRatio;
  }

  // AI : Get rotation angle from top edge and center point
  const bounds = L.latLngBounds(currentCorners);
  const center = bounds.getCenter();
  const centerPoint = map.value.latLngToContainerPoint(center);

  const topVector = { x: ne.x - nw.x, y: ne.y - nw.y };
  const angleRad = Math.atan2(topVector.y, topVector.x);

  return {
    originalRatio,
    newDimensions: { width: newWidth, height: newHeight },
    cornersInfo: { centerPoint, angleRad },
  };
}

function applyImageRatioFix(
  overlayObject: OverlayObject,
  cornersInfo: CornersInfo,
  dimensions: Dimensions,
) {
  if (!overlayObject.overlay) return;

  const { centerPoint, angleRad } = cornersInfo;
  const { width, height } = dimensions;
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  // AI : Calculate the four corners of a rectangle centered at centerPoint, rotated by angleRad
  // AI : Using standard rotation matrix to ensure correct orientation
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  // AI : Define corners in local coordinate system (before rotation)
  const localCorners = [
    { x: -halfWidth, y: -halfHeight }, // NW
    { x: halfWidth, y: -halfHeight }, // NE
    { x: -halfWidth, y: halfHeight }, // SW
    { x: halfWidth, y: halfHeight }, // SE
  ];

  // AI : Apply rotation, translation, and convert to geographic coordinates
  const newCorners: L.LatLng[] = [];
  for (const local of localCorners) {
    const x = centerPoint.x + (local.x * cos - local.y * sin);
    const y = centerPoint.y + (local.x * sin + local.y * cos);
    newCorners.push(map.value.containerPointToLatLng([x, y]));
  }

  overlayObject.overlay.setCorners(newCorners);
}

function resetImageRatio() {
  const overlayStore = useOverlayStore();

  if (!overlayStore.idSelectedOverlay) {
    throw new Error("No image selected: Please select an image first");
  }

  const overlayObject = overlayStore.overlays[overlayStore.idSelectedOverlay];
  if (!overlayObject?.overlay) return;

  const element = overlayObject.overlay.getElement();
  if (!(element instanceof HTMLImageElement)) return;

  // AI : Use existing image element instead of creating a new one to avoid CDN fetch
  const processRatio = () => {
    if (!overlayObject.overlay) return;

    const currentCorners = overlayObject.overlay.getCorners();
    if (currentCorners.length !== 4) return;

    // AI : Convert corners to Leaflet LatLng objects for type compatibility
    const leafletCorners = currentCorners.map((corner) => L.latLng(corner.lat, corner.lng));

    const {
      originalRatio: _originalRatio,
      newDimensions,
      cornersInfo,
    } = calculateRatioFixParameters(element.naturalWidth / element.naturalHeight, leafletCorners);

    applyImageRatioFix(overlayObject, cornersInfo, newDimensions);

    // AI : Save to history after applying ratio fix to ensure changes are detected and overlay is marked as modified
    saveToHistory(overlayObject);

    updateMarkerPosition(overlayObject);
  };

  // AI : If image is already loaded, process immediately; otherwise wait for load
  if (element.complete && element.naturalWidth > 0) {
    processRatio();
  } else {
    element.addEventListener("load", processRatio, { once: true });
  }
}

/**
 * AI : Delete tool - Delete overlay (only shown if user has permission)
 */
const customDeleteTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-trash",
      tooltip: "", // AI : Will be set in initialize
    },
  },
  initialize: function initialize() {
    // AI : Set tooltip dynamically after i18n is ready
    this.options.toolbarIcon.tooltip = t("toolbar.delete");
    L.Toolbar2.Action.prototype.initialize?.apply(this, [...arguments]);
  },
  addHooks: async function addHooks() {
    const overlayStore = useOverlayStore();

    if (!overlayStore.idSelectedOverlay) {
      return;
    }

    const overlayId = overlayStore.idSelectedOverlay;
    const overlayObject = overlayStore.overlays[overlayId];
    if (!overlayObject) return;

    const overlayName = overlayObject.caption ?? "this overlay";
    if (!confirm(t("overlay.confirmDelete", { name: overlayName }))) {
      return;
    }

    await withErrorHandling(
      async () => {
        const success = await deleteOverlayDirect(overlayId, {
          updateUserContributions: true,
          clearCityCaches: true,
        });

        if (success) {
          overlayStore.idSelectedOverlay = null;

          const toast = useToast();
          toast.add({
            severity: "success",
            summary: "Overlay deleted",
            life: 3000,
          });
        }
      },
      { errorMessage: "Failed to delete overlay", logError: true },
    );
  },
});

/**
 * AI : Replace overlay tool - Replace existing overlay with new image
 */
const replaceOverlayTool = L.Toolbar2.Action.extend({
  options: {
    toolbarIcon: {
      className: "pi pi-image",
      tooltip: "", // AI : Will be set in initialize
    },
  },
  initialize: function initialize() {
    // AI : Set tooltip dynamically after i18n is ready
    this.options.toolbarIcon.tooltip = t("toolbar.replace");
    L.Toolbar2.Action.prototype.initialize?.apply(this, [...arguments]);
  },
  addHooks: function addHooks() {
    const overlayStore = useOverlayStore();
    if (!overlayStore.idSelectedOverlay) {
      return;
    }

    // AI : Get the selected overlay to find its project
    const selectedOverlay = overlayStore.overlays[overlayStore.idSelectedOverlay];
    if (!selectedOverlay?.projectId) {
      console.warn("Cannot replace overlay: no project ID found");
      return;
    }

    // AI : Set replacement overlay ID in overlayStore
    overlayStore.requestOverlayReplacement(overlayStore.idSelectedOverlay);

    // AI : Open image upload dialog directly with the overlay's project
    // AI : The ImageUploadDialog will check for replacementOverlayId and handle accordingly
    const uiStore = useUiStore();
    uiStore.openImageUploadDialog(selectedOverlay.projectId);
  },
});

/**
 * AI : View mode tools - Tools available when not in edit mode
 * AI : Lazy initialization to avoid module load timing issues
 */
export function getViewTools() {
  return [
    getInfoTool(),
    L.OpacityAction,
    L.OpacitiesAction,
    previousOverlayTool,
    nextOverlayTool,
    L.StackAction,
  ];
}

/**
 * AI : Get edit tools for an overlay based on user permissions
 * AI : Dynamically builds toolbar with only tools the user has permission to use
 */
export function getEditToolsForOverlay(overlayObject: OverlayObject) {
  const baseTools = [
    getInfoTool(),
    undoTool,
    redoTool,
    L.ResizeRotateAction,
    L.DistortAction,
    resetRatioTool,
    L.OpacityAction,
    L.OpacitiesAction,
    previousOverlayTool,
    nextOverlayTool,
    L.StackAction,
    replaceOverlayTool,
  ];

  // AI : Only add delete tool if user has permission
  if (canDeleteOverlay(overlayObject)) {
    baseTools.push(customDeleteTool);
  }

  // AI : Filter out any undefined tools to prevent toolbar errors
  return baseTools.filter((tool) => tool !== undefined);
}

// AI : Accept HMR updates for this module
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
