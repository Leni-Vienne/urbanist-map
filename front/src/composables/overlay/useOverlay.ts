import L from "leaflet";
import "leaflet-toolbar";
import "leaflet-distortableimage";
import { t } from "@/locales";
import { map, currentZoomLevel } from "@/composables/core/useMap";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/composables/map/useMapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useAuthStore } from "@/stores/authStore";
import type { OverlayObject, Project } from "@/types/index";
import {
  createOverlayObject,
  convertOverlayToData,
  createProjectObject,
} from "@/utils/typeFactories";
import { useProjects, addOverlayToProjectWithId } from "@/composables/project/useProjects";
import { trpc } from "@/client";
import { removeStandaloneProjectMarkerForProject } from "@/composables/map/useStandaloneProjectMarkers";
import {
  getFromEditModeOverlayCache,
  saveCachedPosition,
} from "@/composables/overlay/useOverlayPositionManagement";
import { withErrorHandling } from "@/composables/core/useErrorHandling";
import { validateOverlaySize, leafletCornersToCorners } from "@shared/overlayValidation";
import { useToast } from "@/composables/ui/useToast";
import { selectOverlay } from "@/composables/overlay/useOverlaySelection";
import {
  saveOverlayModificationsToCache,
  saveToHistory,
} from "@/composables/overlay/useOverlayHistory";
import {
  updateMarkerPosition,
  updateMarkerTooltip,
  getOverlayBounds,
  createMarker,
} from "@/composables/overlay/useOverlayMarkers";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { getEditToolsForOverlay, getViewTools } from "@/composables/overlay/useOverlayToolbar";
import {
  createLeafletOverlay,
  renderViewModeOverlays,
  registerRenderingCallbacks,
} from "@/composables/overlay/useOverlayRendering";

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
// AI : createLeafletOverlay moved to useOverlayRendering.ts


// AI : setupOverlayLoadHandler moved to useOverlayRendering.ts

/**
// AI : onOverlayLoaded moved to useOverlayRendering.ts

// AI : initializeOverlayHistory moved to useOverlayHistory.ts
// AI : setupOverlayEventHandlers moved to useOverlayRendering.ts

/**
 * AI : Check overlay size in real-time and show visual warning if too large
 */
function checkOverlaySizeAndWarn(
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

// AI : getCornersForOverlay, getCornersForOverlayWithCache, isValidCorners moved to useOverlayHistory.ts

// AI : createMarkerTitle, updateMarkerPosition moved to useOverlayMarkers.ts

// AI : saveToHistory moved to useOverlayHistory.ts

// AI : saveOverlayModificationsToCache moved to useOverlayHistory.ts

/**
 * AI : Add new overlay to city cache so it persists across zoom changes
 */
export function addNewOverlayToCityCache(overlayObject: OverlayObject, cityId: number): void {
  const mapStore = useMapStore();
  const overlayStore = useOverlayStore();

  // AI : Convert overlay to data format for caching
  const overlayData = convertOverlayToData(overlayObject);

  // AI : Get current city cache for current mode or create empty array
  const currentCache = mapStore.getCityOverlaysAndProjectsCache(cityId, overlayStore.mode) ?? [];

  // AI : Add new overlay to cache (avoid duplicates)
  const existingIndex = currentCache.findIndex((item) => item.id === overlayObject.id);
  if (existingIndex >= 0) {
    // AI : Update existing entry
    currentCache[existingIndex] = overlayData;
  } else {
    // AI : Add new entry
    currentCache.push(overlayData);
  }

  mapStore.setCityProjectsCache(cityId, overlayStore.mode, currentCache);
}

// AI : Selection functions moved to useOverlaySelection.ts

// AI : renderViewModeOverlays moved to useOverlayRendering.ts

// AI : overlaysBeingCreated moved to useOverlayRendering.ts

// AI : renderSingleOverlay moved to useOverlayRendering.ts

// AI : updateMarkerTooltip moved to useOverlayMarkers.ts

// AI : createSingleMarker moved to useOverlayMarkers.ts

// AI : setupOverlayMovementTracking moved to useOverlayRendering.ts

// AI : Overlay Action Functions (moved from useOverlayActions.ts to break circular dependency)

// AI : Helper function to transform backend overlay to CDN format
// AI : Use factory function from typeFactories.ts - removed local implementation

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

// AI : Helper function to zoom to overlay bounds with proper error handling
function zoomToOverlayBounds(overlay: OverlayObject): boolean {
  if (!map.value) return false;

  // AI : Try to get bounds from overlay data (works whether Leaflet overlay exists or not)
  const overlayBounds = getOverlayBounds(overlay);
  if (overlayBounds) {
    mobileAwareFlyToBounds(overlayBounds, {
      padding: [50, 50] as [number, number],
      duration: 1.5,
      easeLinearity: 0.25,
    });
    return true;
  }

  // AI : Fallback to marker position if bounds unavailable
  if (overlay.marker) {
    mobileAwareFlyTo(overlay.marker.getLatLng(), 17, { duration: 1.5, easeLinearity: 0.25 });
    return true;
  }

  return false;
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
    throw new Error(
      `Failed to ${action} overlay: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

function resetImageRatio() {
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

/**
 * AI : Navigates between overlays in the current project based on direction
 * @param direction - Either 'next' or 'previous' to determine navigation direction
 * @returns boolean indicating whether navigation was successful
 */

function focusCameraToOverlay(direction: "next" | "previous") {
  const overlayStore = useOverlayStore();
  const { projects } = useProjects();

  if (!map.value) {
    throw new Error("Map not available: Cannot navigate between overlays");
  }

  // Handle case when no overlay is selected
  if (!overlayStore.idSelectedOverlay) {
    return selectFirstOrLastOverlayInAnyProject(direction);
  }

  const currentOverlay = overlayStore.overlays[overlayStore.idSelectedOverlay];

  if (!currentOverlay?.projectId) {
    return false;
  }

  let project = projects.value[currentOverlay.projectId];
  let projectOverlayIds: string[];

  // AI : If project is not in memory, just find overlays with same projectId
  if (!project) {
    projectOverlayIds = Object.values(overlayStore.overlays)
      .filter((overlay) => overlay.projectId === currentOverlay.projectId)
      .map((overlay) => overlay.id);
  } else {
    projectOverlayIds = project.overlayIds;
  }

  if (projectOverlayIds.length <= 1) {
    const toast = useToast();
    toast.add({ severity: "info", summary: t("overlay.onlyOneOverlayInProject"), life: 3000 });
    return false;
  }

  // Get the next/previous overlay (with wraparound)
  const currentIndex = projectOverlayIds.indexOf(overlayStore.idSelectedOverlay);
  const step = direction === "next" ? 1 : -1;
  const newIndex = (currentIndex + step + projectOverlayIds.length) % projectOverlayIds.length;
  const newOverlayId = projectOverlayIds[newIndex];

  return selectAndCenterOverlay(newOverlayId);
}

function selectFirstOrLastOverlayInAnyProject(direction: "next" | "previous") {
  const { projects } = useProjects();
  const projectIds = Object.keys(projects.value);
  if (!projectIds.length) {
    throw new Error("No projects: Please create a project first");
  }

  for (const projectId of projectIds) {
    const project = projects.value[projectId];
    if (project.overlayIds.length > 0) {
      // Select first overlay for 'next', last overlay for 'previous'
      const index = direction === "next" ? 0 : project.overlayIds.length - 1;
      const overlayId = project.overlayIds[index];

      if (selectAndCenterOverlay(overlayId)) {
        // AI : Selected first/last overlay in project
        return true;
      }
    }
  }

  return false;
}

/**
 * AI : Loads an overlay by ID, fetching from backend if needed
 * AI : This function only handles loading/rendering, not navigation
 * @param overlayId - The ID of the overlay to load
 * @param includeIntersecting - Whether to fetch intersecting overlays (defaults to true for backward compatibility)
 * @returns true if overlay was loaded successfully
 */
async function loadOverlay(
  overlayId: string,
  includeIntersecting: boolean = true,
): Promise<boolean | null> {
  const overlayStore = useOverlayStore();

  // AI : Check if overlay is already loaded locally
  if (overlayStore.overlays[overlayId]) {
    return true;
  }

  // AI : Overlay not found locally - fetch from backend
  return withErrorHandling(
    async () => {
      // AI : Fetch overlay, optionally with intersecting overlays
      const result = await trpc.overlay.getOverlay.query({
        id: overlayId,
        includeIntersecting,
      });

      if (!result.overlay) {
        throw new Error("Overlay not found");
      }

      // AI : Render the main overlay
      renderViewModeOverlays([result.overlay], true, false);

      // AI : Render intersecting overlays if they exist
      if (includeIntersecting && result.intersectingOverlays.length > 0) {
        renderViewModeOverlays(result.intersectingOverlays, true, false);
      }

      // AI : NOTE: We don't check overlayStore.overlays[overlayId] here because overlay registration
      // AI : is async (happens after image loads) and may not complete if zoom level is too low.
      // AI : The critical point is that the backend fetch succeeded.
      return true;
    },
    { errorMessage: "Failed to load overlay", rethrow: true },
  );
}

/**
 * AI : Navigates to a specific overlay by ID (loads + selects + centers)
 * @param overlayId - The ID of the overlay to navigate to
 * @param centerMap - Whether to center the map on the overlay
 * @param includeIntersecting - Whether to fetch intersecting overlays if overlay needs to be loaded
 * @returns boolean indicating whether navigation was successful
 */
export async function navigateToOverlay(
  overlayId: string,
  centerMap: boolean,
  includeIntersecting: boolean,
): Promise<boolean> {
  // AI : Load the overlay first (fetches from backend if needed)
  await loadOverlay(overlayId, includeIntersecting);

  // AI : Then navigate to it
  return selectAndCenterOverlay(overlayId, centerMap);
}

function selectAndCenterOverlay(overlayId: string, centerMap: boolean = true) {
  const overlayStore = useOverlayStore();

  const overlay = overlayStore.overlays[overlayId];

  if (!overlay) {
    return false;
  }

  // AI : selectOverlay handles overlay.select() internally
  selectOverlay(overlayId);

  // AI : Center map on overlay if requested
  if (centerMap) {
    zoomToOverlayBounds(overlay);
  }

  return true;
}

export function updateOverlayInfo(id: string, info: { caption?: string }): void {
  const overlayStore = useOverlayStore();

  const overlayObject = overlayStore.overlays[id];
  if (!overlayObject) return;

  // AI : Track if caption actually changed to set isModified flag
  const oldCaption = overlayObject.caption;
  const newCaption = info.caption ?? null;
  const captionChanged = oldCaption !== newCaption;

  overlayObject.caption = newCaption;

  // AI : Mark as modified if caption changed, so save button enables
  if (captionChanged) {
    overlayObject.isModified = true;
  }

  // AI : Save only the specific overlay being updated, not all overlays
  updateMarkerTooltip(overlayObject);
}

// AI : All toolbar definitions moved to useOverlayToolbar.ts
// AI : Import getEditToolsForOverlay and getViewTools from there

// AI : Register toolbar callbacks to avoid circular dependencies
import { registerToolbarCallbacks } from "@/composables/overlay/useOverlayToolbar";

registerToolbarCallbacks({
  focusCameraToOverlay,
  undo,
  redo,
  resetImageRatio,
});

// AI : Register rendering callbacks to avoid circular dependencies
registerRenderingCallbacks({
  checkOverlaySizeAndWarn,
});
