// AI : Overlay editing operations - extracted from useOverlay.ts
// AI : Handles edit mode state management, undo/redo, image ratio fixing, and overlay creation

import L from "leaflet";
import { t } from "@/locales";
import { map, currentZoomLevel } from "@/services/core/map";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useAuthStore } from "@/stores/authStore";
import type { OverlayObject, Project } from "@/types/index";
import { createOverlayObject, createProjectObject } from "@/utils/typeFactories";
import { addOverlayToProjectWithId } from "@/services/project/projects";
import { removeStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import {
  getFromEditModeOverlayCache,
  saveCachedPosition,
} from "@/services/overlay/overlayPositionManagement";
import { validateOverlaySize, leafletCornersToCorners } from "@shared/overlayValidation";
import { useToast } from "@/composables/ui/useToast";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { saveOverlayModificationsToCache, saveToHistory } from "@/services/overlay/overlayHistory";
import {
  updateMarkerPosition,
  updateMarkerTooltip,
  createMarker,
} from "@/services/overlay/overlayMarkers";
import { MAP_CONFIG } from "@/constants/mapConstants";
import {
  getEditToolsForOverlay,
  getViewTools,
  registerToolbarCallbacks,
} from "@/services/overlay/overlayToolbar";
import { createLeafletOverlay } from "@/services/overlay/overlayRendering";
import { addNewOverlayToCityCache } from "@/services/overlay/overlayCityCache";

// AI : Navigation function callback - will be registered by useOverlay.ts
// AI : Declared at module level to avoid temporal dead zone issues
let focusCameraToOverlayCallback: ((direction: "next" | "previous") => void) | null = null;

export function registerNavigationCallback(callback: (direction: "next" | "previous") => void) {
  focusCameraToOverlayCallback = callback;
}

// AI : Wrapper to call the navigation callback if it's registered
function focusCameraToOverlay(direction: "next" | "previous") {
  if (focusCameraToOverlayCallback) {
    focusCameraToOverlayCallback(direction);
  }
}

/**
 * AI : Update overlay editing state based on current mode
 * AI : This function updates existing overlays in-place with new toolbar actions
 * AI : and restores/resets positions based on whether we're entering or leaving edit mode
 */
export function updateOverlayEditingState(): void {
  const overlayStore = useOverlayStore();

  // AI : Save popup and selection state before toolbar rebuild
  const wasPopupOpen = overlayStore.showInfoPopup;
  const selectedOverlayId = overlayStore.idSelectedOverlay;
  const wasSelected = !!selectedOverlayId;

  // AI : Close popup before toolbar rebuild to avoid orphaned teleport state
  if (wasPopupOpen) {
    overlayStore.hideInfoPopup();
  }

  // AI : Update existing overlays in-place instead of recreating them
  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    if (!overlayObject.overlay) return;

    // AI : Ensure overlay is on the map before attempting to manipulate it
    if (!map.value || !map.value.hasLayer(overlayObject.overlay)) return;

    // AI : Update overlay options using the setOptions method
    const isEditMode = overlayStore.mode === "edit";
    overlayObject.overlay.setOptions({
      actions: [...(isEditMode ? getEditToolsForOverlay(overlayObject) : getViewTools())],
      draggable: isEditMode,
    });

    // AI : When entering edit mode, restore cached corner positions if they exist
    if (isEditMode) {
      const cachedModifications = getFromEditModeOverlayCache(overlayObject.id);
      if (cachedModifications?.corners?.length === 4) {
        // AI : Restore cached corners to overlay
        const leafletCorners = cachedModifications.corners.map((corner) =>
          L.latLng(corner.lat, corner.lng),
        );
        overlayObject.overlay.setCorners(leafletCorners);

        // AI : Only initialize history if it's empty (preserve existing undo/redo history)
        if (overlayObject.history.length === 0) {
          overlayObject.history = [cachedModifications.corners];
        }
        overlayObject.isModified = cachedModifications.isModified;

        // AI : Update marker position to match restored corners
        updateMarkerPosition(overlayObject);
      }

      // AI : When leaving edit mode (entering view/moderation mode), FIRST save to cache, THEN reset
    } else {
      // AI : CRITICAL: Save current position to cache BEFORE resetting to backend
      // AI : This fixes the bug where edit→moderation→edit loses the modified position
      if (overlayObject.overlay && (overlayObject.isModified || overlayObject.history.length > 1)) {
        const currentCorners = overlayObject.overlay.getCorners();
        if (currentCorners?.length === 4) {
          // AI : getCorners() returns L.LatLng[], convert to plain objects
          const corners = currentCorners.map((c) => ({ lat: c.lat, lng: c.lng }));
          saveCachedPosition(overlayObject.id, corners, overlayObject.isModified ?? false);
        }
      }

      // AI : Now reset to backend positions for display
      if (overlayObject.corners && overlayObject.corners.length === 4) {
        const leafletCorners = overlayObject.corners.map((corner) =>
          L.latLng(corner.lat, corner.lng),
        );
        overlayObject.overlay.setCorners(leafletCorners);
        overlayObject.isModified = false;

        // AI : Update marker position to match backend corners
        updateMarkerPosition(overlayObject);
      }
    }

    // AI : Update marker color and tooltip
    updateMarkerTooltip(overlayObject);
  });

  // AI : Restore selection state after toolbar rebuild
  if (wasSelected && selectedOverlayId) {
    requestAnimationFrame(() => {
      const overlay = overlayStore.overlays[selectedOverlayId];
      if (overlay?.overlay) {
        selectOverlay(selectedOverlayId);
      }
    });
  }

  // AI : Reopen popup after toolbar is rebuilt with new actions
  if (wasPopupOpen && selectedOverlayId) {
    requestAnimationFrame(() => {
      const overlay = overlayStore.overlays[selectedOverlayId];
      if (overlay?.overlay) {
        // AI : Find and click the info button to recreate teleport target and reopen popup
        const overlayElement = overlay.overlay.getElement();
        let infoButton = overlayElement?.parentElement?.querySelector(
          ".leaflet-toolbar-icon.pi-ellipsis-v",
        ) as HTMLElement;

        if (!infoButton) {
          const allInfoButtons = document.querySelectorAll(".leaflet-toolbar-icon.pi-ellipsis-v");
          infoButton = allInfoButtons[0] as HTMLElement;
        }

        if (infoButton) {
          infoButton.click();
        }
      }
    });
  }
}

/**
 * AI : Check overlay size in real-time and show visual warning if too large
 */
export function checkOverlaySizeAndWarn(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
): void {
  const corners = overlay.getCorners();

  // AI : Guard clause - corners can be undefined for newly created overlays
  if (!corners || corners.length !== 4) {
    return;
  }

  const cornersArray = leafletCornersToCorners(corners);
  const validation = validateOverlaySize(cornersArray);

  const element = overlay.getElement();
  if (!element) return;

  if (!validation.isValid) {
    // AI : Add red border to indicate size problem
    element.style.border = "4px solid #ef4444";
    element.style.boxShadow = "0 0 0 2px rgba(239, 68, 68, 0.3)";

    // AI : Update marker color if not already marked
    if (!overlayObject.isTooBig) {
      overlayObject.isTooBig = true;
      updateMarkerTooltip(overlayObject);
    }

    // AI : Show toast message every time overlay is edited while too large
    const toast = useToast();
    toast.add({
      severity: "warn",
      summary: "Overlay too large",
      detail: "Maximum size is 1km × 1km",
      life: 3000,
    });
  } else {
    // AI : Remove warning styling
    element.style.border = "";
    element.style.boxShadow = "";

    // AI : Clear size issue flag and update marker color
    if (overlayObject.isTooBig) {
      overlayObject.isTooBig = false;
      updateMarkerTooltip(overlayObject);
    }
  }
}

// AI : Helper function to create new overlay with proper Drizzle schema structure
function createNewOverlayObject(id: string, imageUrl: string, projectId: string): OverlayObject {
  const filename = imageUrl.split("/").pop() ?? "";
  const authStore = useAuthStore();

  // AI : Use factory function for consistent object creation
  // AI : status: null indicates overlay hasn't been submitted to backend yet
  return createOverlayObject({
    id,
    filename,
    projectId,
    authorId: authStore.user?.id ?? null, // AI : Set to current user's ID
    imageUrl,
    isModified: true, // AI : New overlays need to be uploaded
    status: undefined, // AI : undefined = never submitted, "pending" = submitted awaiting review
  });
}

/**
 * AI : Add a new overlay to the map
 *
 * @param imageUrl
 * @param projectId
 * @param replacesOverlayId
 * @returns the ID of the newly created overlay
 */
export function addOverlay(imageUrl: string, projectId: string, replacesOverlayId?: string) {
  const overlayStore = useOverlayStore();

  // AI : Only allow adding overlays in edit mode
  if (overlayStore.mode !== "edit") {
    return;
  }

  if (!map.value) return;
  if (!projectId) {
    throw new Error("Project Required: A project must be selected to add an overlay");
  }

  const id = crypto.randomUUID();

  // AI : Create overlay object using proper schema structure
  const overlayObject = createNewOverlayObject(id, imageUrl, projectId);

  // AI : If this is a replacement overlay, set the replacement reference
  if (replacesOverlayId) {
    overlayObject.replacesOverlayId = replacesOverlayId;
    const originalOverlay = overlayStore.overlays[replacesOverlayId];
    overlayObject.caption = `Replacement for ${originalOverlay?.caption ?? "overlay"}`;
  }

  // AI : Check if we need to zoom in to make overlay visible
  const needsZoom = currentZoomLevel.value < MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;
  const projectStore = useProjectStore();

  // AI : Try to find project in multiple store locations
  let project = projectStore.projects[projectId] ?? projectStore.allProjects[projectId];

  // AI : If not found in projects or allProjects, check userContributions
  if (!project) {
    const userContribution = projectStore.userContributions.find((p) => p.id === projectId);
    if (userContribution) {
      // AI : User contributions have lat/lng, use them directly
      // AI : Convert using factory to ensure proper Project type (handling extra fields via safe cast)
      project = createProjectObject(userContribution as unknown as Partial<Project>);
    }
  }

  // AI : Function to create and setup the overlay (extracted to be called after zoom if needed)
  const createAndSetupOverlay = () => {
    // Create the overlay
    const newOverlay = createLeafletOverlay(imageUrl, overlayObject);
    if (!newOverlay) return;

    // AI : Wait for element to load asynchronously - getElement() returns undefined until added to DOM
    const waitForElement = () => {
      const element = newOverlay.getElement();
      if (!element) {
        // AI : Element not ready yet, try again on next frame
        requestAnimationFrame(waitForElement);
        return;
      }

      L.DomEvent.on(element, "load", () => {
        if (element.complete && element.naturalWidth > 0) {
          overlayObject.overlay = newOverlay;
          overlayObject.corners = newOverlay.getCorners() ?? [];

          // AI : Store reference and initialize with proper reactivity
          overlayStore.addOverlay(id, overlayObject);

          // AI : Create marker with appropriate color based on replacement status
          createMarker(overlayObject);

          // AI : Add to project AFTER storing in overlays to avoid "not found" error
          const isFirstOverlay = addOverlayToProjectWithId(projectId, id);

          // AI : Remove standalone project marker when first overlay is added to project
          if (isFirstOverlay) {
            removeStandaloneProjectMarkerForProject(projectId);
          }

          // AI : Add new overlay to city cache so it persists across zoom changes
          if (project?.city) {
            addNewOverlayToCityCache(overlayObject, project.city.id);
          }

          // AI : Automatically select the newly created overlay for immediate positioning
          selectOverlay(id);
        }
      });
    };

    // AI : Start waiting for element to be ready
    waitForElement();
  };

  // AI : If zoom level is too low, zoom to project location first, then create overlay
  if (needsZoom && project?.lat != null && project?.lng != null) {
    const targetZoom = 16; // AI : Zoom level high enough to show overlay clearly

    // AI : Show toast to inform user about auto-zoom
    const toast = useToast();
    toast.add({
      severity: "info",
      summary: t("overlay.zoomingToProject"),
      detail: t("overlay.zoomInToSeeOverlay"),
      life: 4000,
    });

    mobileAwareFlyTo(L.latLng(project.lat, project.lng), targetZoom, {
      duration: 1.5,
      easeLinearity: 0.25,
    });

    // AI : Wait for zoom to complete before creating overlay
    if (map.value) {
      map.value.once("zoomend", () => {
        createAndSetupOverlay();
      });
    }
  } else {
    // AI : Zoom is already sufficient, create overlay immediately
    createAndSetupOverlay();
  }

  return id;
}

export function undo() {
  applyHistoryAction("undo");
}

export function redo() {
  applyHistoryAction("redo");
}

function applyHistoryAction(action: "undo" | "redo") {
  const overlayStore = useOverlayStore();

  if (!overlayStore.idSelectedOverlay) return;

  const overlayObject = overlayStore.overlays[overlayStore.idSelectedOverlay];
  if (!overlayObject?.overlay) return;

  const { history, redoStack, overlay } = overlayObject;
  const isUndo = action === "undo";

  if ((isUndo && history.length <= 1) || (!isUndo && redoStack.length === 0)) {
    return;
  }

  try {
    if (isUndo) {
      // AI : For undo: move current state to redo stack and apply previous state
      const currentState = history.pop()!;
      redoStack.push(currentState);
      const previousState = history[history.length - 1];
      overlay.setCorners(previousState);

      // AI : If we're back to the initial state (history.length === 1) and overlay is approved, mark as unmodified
      if (history.length === 1 && overlayObject.status === "approved") {
        overlayObject.isModified = false;
      }
    } else {
      // AI : For redo: move state from redo stack to history and apply it
      const stateToRestore = redoStack.pop()!;
      history.push(stateToRestore);
      overlay.setCorners(stateToRestore);

      // AI : Redoing any change means the overlay is modified again
      overlayObject.isModified = true;
    }

    // AI : Update marker position and color after undo/redo
    updateMarkerPosition(overlayObject);
    updateMarkerTooltip(overlayObject);

    // AI : Update cache (undo/redo only available in edit mode)
    // AI : No need to call updateOverlayMarkersColors - updateMarkerTooltip already updates icon
    saveOverlayModificationsToCache(overlayObject);
  } catch (error) {
    console.error(error);
  }
}

export function resetImageRatio() {
  const overlayStore = useOverlayStore();

  if (!overlayStore.idSelectedOverlay) {
    throw new Error("No image selected: Please select an image first");
  }

  const overlayObject = overlayStore.overlays[overlayStore.idSelectedOverlay];
  if (overlayObject?.overlay == null) return;

  const element = overlayObject.overlay.getElement();
  if (!(element instanceof HTMLImageElement)) return;

  // AI : Use existing image element instead of creating a new one to avoid CDN fetch
  const processRatio = () => {
    if (!overlayObject.overlay || !map.value) return;

    const currentCorners = overlayObject.overlay.getCorners();
    if (!currentCorners?.length || currentCorners.length !== 4) return;

    // AI : Convert corners to Leaflet LatLng objects for type compatibility
    const leafletCorners = currentCorners.map((corner) => L.latLng(corner.lat, corner.lng));

    const {
      originalRatio: _originalRatio,
      newDimensions,
      cornersInfo,
    } = calculateRatioFixParameters(element.naturalWidth / element.naturalHeight, leafletCorners);

    if (!cornersInfo) return;

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
  if (!map.value)
    return {
      originalRatio,
      newDimensions: { width: 0, height: 0 },
      cornersInfo: { centerPoint: L.point(0, 0), angleRad: 0 },
    };

  // AI : Convert corners to screen coordinates
  const nw = map.value.latLngToContainerPoint(currentCorners[0]);
  const ne = map.value.latLngToContainerPoint(currentCorners[1]);
  const sw = map.value.latLngToContainerPoint(currentCorners[2]);
  const se = map.value.latLngToContainerPoint(currentCorners[3]);

  // AI : Calculate current dimensions by averaging opposite edges
  const topEdge = nw.distanceTo(ne);
  const rightEdge = ne.distanceTo(se);
  const bottomEdge = sw.distanceTo(se);
  const leftEdge = nw.distanceTo(sw);

  const currentWidth = (topEdge + bottomEdge) / 2;
  const currentHeight = (leftEdge + rightEdge) / 2;

  // AI : Calculate new dimensions that maintain original ratio
  let newWidth, newHeight;
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
  if (!map.value || !overlayObject.overlay) return;

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

// AI : Register toolbar callbacks to avoid circular dependencies
// AI : This must be done here (not in useOverlay.ts) because these functions are defined in this file
registerToolbarCallbacks({
  focusCameraToOverlay,
  undo,
  redo,
  resetImageRatio,
});
