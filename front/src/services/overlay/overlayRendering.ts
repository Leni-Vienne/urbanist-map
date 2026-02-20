// AI : Leaflet overlay rendering and DOM manipulation
// AI : Extracted from useOverlay.ts to separate rendering concerns from business logic
// AI : Handles all Leaflet-specific overlay creation, loading, and event binding

import L from "leaflet";
import "leaflet-distortableimage";
import { map } from "@/services/core/map";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import { updateOverlayMarkersColors } from "@/services/map/markers";
import { imageRequiresCredentials } from "@/utils/imageUrl";
import { MAP_CONFIG } from "@/constants/mapConstants";
import { createOverlayFromCDN } from "@/utils/typeFactories";
import { removeStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import {
  selectOverlay,
  setupProjectHoverEvents,
  syncModerationCityFromOverlay,
} from "@/services/overlay/overlaySelection";
import {
  initializeOverlayHistory,
  getCornersForOverlayWithCache,
  saveToHistory,
} from "@/services/overlay/overlayHistory";
import { enrichOverlayWithProject } from "@/services/overlay/overlayData";
import {
  updateMarkerPosition,
  updateMarkerTooltip,
  createSingleMarker,
} from "@/services/overlay/overlayMarkers";
import { getEditToolsForOverlay, getViewTools } from "@/services/overlay/overlayToolbar";
import type { OverlayObject, OverlayData } from "@/types/index";

// AI : Callback type for checkOverlaySizeAndWarn - will be registered by useOverlay.ts
type CheckOverlaySizeAndWarnFn = (
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
) => void;

// AI : Callback for checkOverlaySizeAndWarn - will be registered by useOverlay.ts
let checkOverlaySizeAndWarn: CheckOverlaySizeAndWarnFn | null = null;

/**
 * AI : Register callback for checkOverlaySizeAndWarn
 * AI : Called by useOverlay.ts to provide the function
 */
export function registerRenderingCallbacks(callbacks: {
  checkOverlaySizeAndWarn: CheckOverlaySizeAndWarnFn;
}) {
  checkOverlaySizeAndWarn = callbacks.checkOverlaySizeAndWarn;
}

/**
 * AI : Track overlays currently being created to prevent duplicates
 * AI : When renderSingleOverlay is called multiple times before onAddedToMap callback fires,
 * AI : this prevents creating multiple Leaflet objects for the same overlay ID
 */
const overlaysBeingCreated = new Set<string>();

/**
 * AI : Clear the in-progress tracking set
 * AI : Called by clearAllOverlays to prevent stale entries when overlays are removed from map
 */
export function clearOverlaysBeingCreated(): void {
  overlaysBeingCreated.clear();
}

/**
 * AI : Create a Leaflet overlay on the map
 * AI : @param onAddedToMap - Optional callback invoked when overlay is successfully added to map
 */
export function createLeafletOverlay(
  imageUrl: string,
  overlayObject?: OverlayObject,
  onAddedToMap?: () => void,
) {
  const overlayStore = useOverlayStore();

  if (!overlayObject) return null;

  overlayObject.imageUrl = imageUrl;

  try {
    // AI : Get corners with edit mode cache awareness for position persistence
    const corners = getCornersForOverlayWithCache(overlayObject);

    // AI : Convert corners to Leaflet LatLng objects if available
    const leafletCorners = corners
      ? corners.map((corner) => L.latLng(corner.lat, corner.lng))
      : undefined;
    const isEditMode = overlayStore.mode === "edit";

    const newOverlay = L.distortableImageOverlay(imageUrl, {
      editable: true,
      keyboard: false,
      actions: [...(isEditMode ? getEditToolsForOverlay(overlayObject) : getViewTools())],
      corners: leafletCorners,
      dragBehavior: "auto",
      selectOnDrag: false,
      draggable: isEditMode,
      // AI : CRITICAL: Only enable credentials for local backend URLs (pending images)
      // AI : R2 CDN URLs don't support credentials and will fail if crossOrigin is set
      crossOrigin: imageRequiresCredentials(imageUrl) ? "use-credentials" : undefined,
      //mode: 'resizeRotate' // doesn't work but should, it's an issue from the package
    });

    overlayObject.overlay = newOverlay;

    setupOverlayEventHandlers(newOverlay, overlayObject);

    setupOverlayLoadHandler(newOverlay, overlayObject, onAddedToMap);

    // AI : Always add overlay to map - visibility based on zoom is handled by useOverlayZoomHandler
    // AI : This waits for any ongoing zoom animation to complete before adding to prevent visual glitches
    const addOverlayWhenReady = () => {
      const currentZoom = map.value.getZoom();
      const shouldShowImage = currentZoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;

      // AI : Only add to map if zoom is appropriate (zoom handler will manage later changes)
      if (shouldShowImage) {
        // AI : CRITICAL FIX: Re-verify visibility before adding (async race condition protection)
        // AI : The mode might have changed while waiting for zoom animation (View -> Edit -> View)
        const authStore = useAuthStore();
        if (!isOverlayVisible(overlayObject, overlayStore.mode, authStore.user?.id)) {
          // AI : Abort adding if no longer visible
          overlaysBeingCreated.delete(overlayObject.id);
          return;
        }

        // AI : CRITICAL: Check if already on map to prevent duplicates
        // AI : This can happen when renderFullOverlays is called multiple times before onAddedToMap callback completes
        if (map.value.hasLayer(newOverlay)) {
          return;
        }

        newOverlay.addTo(map.value);
      } else {
        // AI : Zoom is too low - overlay won't be added to map
        // AI : Remove from in-progress tracking since onAddedToMap will never fire
        overlaysBeingCreated.delete(overlayObject.id);
      }
    };

    // Check if map is currently zooming, _animatingZoom isn't documented for some reason
    if (map.value._animatingZoom) {
      // AI : Wait for zoom animation to complete
      map.value.once("zoomend", addOverlayWhenReady);
    } else {
      // AI : No animation - add immediately if zoom is appropriate
      addOverlayWhenReady();
    }

    return newOverlay;
  } catch (error) {
    console.error("Failed to create overlay:", error);
    return null;
  }
}

/**
 * AI : Queue for progressive overlay initialization to prevent main thread blocking
 * AI : Maps OverlayID -> Initialization Callback
 * Loads them 2 by 2 basically
 */
const initQueue = new Map<string, () => void>();
let isInitQueueRunning = false;

function processInitQueue() {
  if (initQueue.size === 0) {
    isInitQueueRunning = false;
    return;
  }

  isInitQueueRunning = true;

  // AI : Process up to 2 overlays per frame
  // AI : This prevents "Animation frame fired" blocks in performance profile
  // AI : caused by simultaneous completion of multiple image loads (cache burst)
  let processedCount = 0;
  const BATCH_SIZE = 2;

  for (const [id, initFn] of initQueue) {
    if (processedCount >= BATCH_SIZE) break;

    // AI : Execute initialization
    initFn();

    // AI : Remove from queue
    initQueue.delete(id);
    processedCount += 1;
  }

  // AI : Continue in next frame
  if (initQueue.size > 0) {
    requestAnimationFrame(processInitQueue);
  } else {
    isInitQueueRunning = false;
  }
}

function scheduleInitialization(id: string, initFn: () => void) {
  if (initQueue.has(id)) return;

  initQueue.set(id, initFn);

  if (!isInitQueueRunning) {
    processInitQueue();
  }
}

/**
 * AI : Handle overlay load event with all initialization logic
 */
function setupOverlayLoadHandler(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
  onReady?: () => void,
): void {
  const element = overlay.getElement();
  if (!element) {
    // AI : Element should be available immediately after addTo(), but add minimal fallback
    requestAnimationFrame(() => {
      setupOverlayLoadHandler(overlay, overlayObject, onReady);
    });
    return;
  }

  let isInitialized = false;

  const tryInit = () => {
    if (isInitialized) return;

    // AI : Guard: Only proceed if overlay is still on map (prevents errors during rapid viewport changes)
    if (!map.value.hasLayer(overlay)) {
      return;
    }

    if (element.complete && element.naturalWidth > 0) {
      isInitialized = true;

      // AI : Cleanup listeners to prevent redundant calls
      L.DomEvent.off(element, "load", tryInit);
      overlay.off("add", tryInit);

      // AI : CRITICAL OPTIMIZATION: Schedule initialization instead of running synchronously
      // AI : This fixes the "lag spike" when multiple cached images load simultaneously
      scheduleInitialization(overlayObject.id, () => {
        // AI : Re-check existence before running (user might have panned away)
        if (map.value.hasLayer(overlay)) {
          onOverlayLoaded(overlayObject, onReady);
        }
      });
    }
  };

  L.DomEvent.on(element, "load", tryInit);

  // AI : CRITICAL FIX: Also check when added to map
  // AI : This handles the case where the image loads while waiting for zoom animation (flyTo)
  // AI : In that case, the 'load' event fires while hasLayer() is false, so we missed it.
  // AI : When 'add' fires later, we check again.
  overlay.on("add", tryInit);

  // AI : Handle load errors to ensure system consistency
  L.DomEvent.on(element, "error", () => {
    console.warn("Overlay image failed to load:", overlayObject.id);
    initQueue.delete(overlayObject.id); // Cancel pending init if error
    // AI : Execute callback even on error so the overlay is registered in the store
    // AI : This prevents it from being stuck in a "rendering" state without a store entry
    if (onReady) {
      onReady();
    }
  });

  // AI : Check immediately in case it's already loaded and on map
  tryInit();
}

/**
 * AI : Handle all logic when overlay finishes loading
 */
function onOverlayLoaded(overlayObject: OverlayObject, onReady?: () => void): void {
  const overlayStore = useOverlayStore();

  if (!overlayObject.overlay) return;

  updateMarkerPosition(overlayObject);

  initializeOverlayHistory(overlayObject);

  updateMarkerTooltip(overlayObject);

  // AI : Check size validation for overlays in edit mode
  if (overlayStore.mode === "edit" && checkOverlaySizeAndWarn) {
    checkOverlaySizeAndWarn(overlayObject.overlay, overlayObject);
  }

  // AI : Setup hover events for project highlighting after element is available
  setupProjectHoverEvents(overlayObject.overlay, overlayObject);

  // AI : CRITICAL: Setup movement tracking AFTER overlay is loaded and has a DOM element
  // AI : This must be called here (not in setupOverlayEventHandlers) because overlay.getElement()
  // AI : returns null until the overlay is added to the map and the image loads
  setupOverlayMovementTracking(overlayObject.overlay, overlayObject);

  // AI : Ensure new overlays start with no outline unless they're selected
  if (overlayStore.idSelectedOverlay !== overlayObject.id) {
    const element = overlayObject.overlay.getElement();
    if (element) {
      element.style.boxShadow = "";
      element.style.outline = "none";
    }
  }

  // AI : Invoke the caller's callback now that the overlay is fully initialized
  if (onReady) {
    onReady();
  }
}

/**
 * AI : Setup overlay event handlers for selection, deselection, and editing
 */
function setupOverlayEventHandlers(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
): void {
  const overlayStore = useOverlayStore();

  overlay.on("select", () => {
    // AI : In moderation mode, clicking a contribution should load the city context
    // AI : This ensures clicking the image itself (not just the marker) loads the city
    syncModerationCityFromOverlay(overlayObject);

    // AI : Use centralized selection function for consistent behavior
    selectOverlay(overlayObject.id);
  });

  overlay.on("deselect", () => {
    // AI : Only handle deselect for the overlay that was actually selected
    if (overlayStore.idSelectedOverlay === overlayObject.id) {
      // AI : Use centralized selection function (null = deselect all)
      selectOverlay(null);

      // AI : Hide InfoPopup when overlay is deselected
      if (overlayStore.showInfoPopup) {
        overlayStore.hideInfoPopup();
      }
    }
  });

  // Listens to the map being moved
  overlay.on("dragend", () => {
    saveToHistory(overlayObject);
  });

  // listens to individual corners being moved
  overlay.on("edit", () => {
    // AI : Handle transition from backend to local copy when edited
    updateMarkerPosition(overlayObject);

    // AI : Validate overlay size in real-time
    if (checkOverlaySizeAndWarn) {
      checkOverlaySizeAndWarn(overlay, overlayObject);
    }

    saveToHistory(overlayObject);
  });

  // AI : NOTE: setupOverlayMovementTracking is called in onOverlayLoaded() instead of here
  // AI : because the overlay element doesn't exist until after the overlay is added to the map
  // AI : and the image finishes loading
}

/**
 * AI : Set up additional movement tracking for overlays (real-time updates during manipulation)
 */
function setupOverlayMovementTracking(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
): void {
  // AI : Set up DOM event listeners for continuous marker position updates during manipulation
  const element = overlay.getElement();

  if (element) {
    let isManipulating = false;
    let updateFrame: number | null = null;
    let hasActuallyMoved = false;

    // AI : Stop tracking handler - behaves like 'mouseup'/'touchend'
    function stopTracking() {
      const overlayStore = useOverlayStore();

      if (!isManipulating) return;
      isManipulating = false;

      if (updateFrame) {
        cancelAnimationFrame(updateFrame);
        updateFrame = null;
      }

      // AI : Clean up document listeners immediately when drag ends
      // AI : This prevents memory leaks and piling up listeners
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("mousemove", onMovement);
      document.removeEventListener("touchmove", onMovement);

      if (hasActuallyMoved) {
        updateMarkerPosition(overlayObject);
        updateOverlayMarkersColors(overlayStore.overlays, overlayStore.mode, overlayObject.id);
      }
    }

    // AI : Update loop for smooth animation
    function performUpdate() {
      if (isManipulating) {
        updateMarkerPosition(overlayObject);
        hasActuallyMoved = true;
        updateFrame = requestAnimationFrame(performUpdate);
      }
    }

    // AI : Event handlers using hoisted functions for proper scoping
    function onMouseUp() {
      stopTracking();
    }

    function onMovement() {
      if (isManipulating && !hasActuallyMoved) {
        performUpdate();
      }
    }

    function onTouchEnd() {
      stopTracking();
    }

    // AI : Start tracking handler - behaves like 'mousedown'/'touchstart'
    function startTracking() {
      if (isManipulating) return;
      isManipulating = true;
      hasActuallyMoved = false;

      // AI : Add document listeners ONLY when tracking starts
      document.addEventListener("mouseup", onMouseUp);
      document.addEventListener("touchend", onTouchEnd);
      document.addEventListener("mousemove", onMovement);
      document.addEventListener("touchmove", onMovement, { passive: true });

      // AI : We don't start the loop here immediately; we wait for the first move event
      // AI : This avoids running the loop just for a click
    }

    // AI : Track mouse and touch events on the element itself to start the process
    element.addEventListener("mousedown", startTracking);
    element.addEventListener("touchstart", startTracking, { passive: true });
  }
}

/**
 * AI : Render backend CDN overlays on the map for view mode
 */
export function renderViewModeOverlays(
  viewModeOverlays: OverlayData[],
  createMarkers = true,
  forceRerender = false,
) {
  const overlayStore = useOverlayStore();

  let overlaysToRender: OverlayData[] = [];

  if (forceRerender) {
    // AI : Force re-render all overlays (for city switching)
    overlaysToRender = viewModeOverlays;
  } else {
    // AI : Render overlays that either:
    // AI : 1. Don't exist in the store yet (new overlays)
    // AI : 2. Exist but have null Leaflet layer (need re-rendering after zoom out)
    overlaysToRender = viewModeOverlays.filter((cdnOverlay) => {
      const existing = overlayStore.overlays[cdnOverlay.id];
      if (!existing) return true; // New overlay
      return existing.overlay === null; // Needs re-rendering
    });
  }

  for (const cdnOverlay of overlaysToRender) {
    renderSingleOverlay(cdnOverlay, createMarkers);
  }
}

/**
 * AI : Render a single CDN overlay as read-only distortable overlay on the map
 */
function renderSingleOverlay(cdnOverlay: OverlayData, createMarkers = true) {
  const overlayStore = useOverlayStore();

  // AI : Skip replaced overlays - their images are deleted and would cause 404 errors
  if (cdnOverlay.status === "replaced") return;

  // AI : Check if overlay exists in store WITH a valid Leaflet layer
  // AI : If overlay exists but has null layer (preserved after zoom out), we need to re-render it
  const existingOverlay = overlayStore.overlays[cdnOverlay.id];
  const hasValidLayer = existingOverlay && existingOverlay.overlay !== null;

  // AI : CRITICAL: Also check if this overlay is currently being created
  // AI : This prevents duplicates when renderFullOverlays is called multiple times rapidly
  const isBeingCreated = overlaysBeingCreated.has(cdnOverlay.id);

  if (hasValidLayer || isBeingCreated) {
    return;
  }

  // AI : Mark this overlay as being created
  overlaysBeingCreated.add(cdnOverlay.id);

  // AI : Always use backend data to create overlay object (cached positions applied later via applyPositionToOverlay)
  const overlayObject = createOverlayFromCDN(cdnOverlay);

  // AI : Preserve UI state (like view choice) from existing store object if re-rendering
  if (existingOverlay) {
    overlayObject.isViewingApprovedPosition = existingOverlay.isViewingApprovedPosition;
  }

  if (createMarkers) {
    createSingleMarker(overlayObject);
  }

  const overlayObjectWithMethods = enrichOverlayWithProject(overlayObject);

  // AI : onOverlayFullyLoaded is passed as a callback but only fires asynchronously — after
  // AI : the image has loaded and Leaflet has completed its setup. It is intentionally defined
  // AI : after createLeafletOverlay() to keep the reading order logical (caller before callback);
  // AI : hoisting makes it available to pass as an argument above its definition.
  const newOverlay = createLeafletOverlay(
    overlayObjectWithMethods.imageUrl,
    overlayObjectWithMethods,
    onOverlayFullyLoaded,
  );

  if (!newOverlay) {
    // AI : Creation failed - remove from in-progress tracking
    overlaysBeingCreated.delete(cdnOverlay.id);
    return;
  }

  // AI : Register the overlay in the store ONLY after the image has loaded and Leaflet is done.
  // AI : Registering earlier would create ghost overlays if clearAllOverlays() is called
  // AI : during a concurrent zoom animation.
  // AI : By the time this fires:
  // AI :   - overlayObjectWithMethods.overlay is set (by createLeafletOverlay above)
  // AI :   - the marker exists in overlayStore.allMarkers (created by createSingleMarker above)
  function onOverlayFullyLoaded() {
    const marker = overlayStore.allMarkers[cdnOverlay.id];
    // AI : Marker may be gone if the user panned away before the image finished loading
    if (!marker) return;

    overlayObjectWithMethods.marker = marker;

    overlayStore.addOverlay(cdnOverlay.id, overlayObjectWithMethods);

    // AI : Update the tooltip here rather than in createSingleMarker, because the mode may have
    // AI : changed during the async image load (e.g. a View -> Edit switch mid-navigation).
    updateMarkerTooltip(overlayObjectWithMethods);

    overlaysBeingCreated.delete(cdnOverlay.id);

    // AI : A standalone project marker may have been shown for this project while its overlays
    // AI : were pending/invisible. Remove it now that a real overlay is on the map.
    if (cdnOverlay.projectId) {
      removeStandaloneProjectMarkerForProject(cdnOverlay.projectId);
    }
  }
}

// AI : Accept HMR updates for this module
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
