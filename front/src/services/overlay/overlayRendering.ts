// Leaflet overlay rendering and DOM manipulation
// Extracted from useOverlay.ts to separate rendering concerns from business logic
// Handles all Leaflet-specific overlay creation, loading, and event binding

import L from "leaflet";
// leaflet-toolbar must be imported before leaflet-distortableimage because
// the distortableimage IIFE uses L.Toolbar2.Action at module evaluation time (t[280]).
// In ESM, imports are evaluated in declaration order, so this ordering is critical
// to ensure L.Toolbar2 exists before the distortableimage bundle's IIFE runs.
import "leaflet-toolbar";
import "leaflet-distortableimage";
import { map } from "@/services/core/map";

// leaflet-distortableimage's addInitHook adds the 'ldi' class to the map container,
// which is required for the CSS rule that sets pointer-events: all on overlay images.
// Since this chunk loads lazily after map creation, the addInitHook never ran for the
// existing map — we must apply it manually here.
if (map.value && !L.DomUtil.hasClass(map.value.getContainer(), "ldi")) {
  L.DomUtil.addClass(map.value.getContainer(), "ldi");
}
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import { updateOverlayMarkersColors } from "@/services/map/markers";
import { imageRequiresCredentials } from "@/utils/imageUrl";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { createOverlayObject } from "@/utils/typeFactories";
import { removeStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import {
  selectOverlay,
  setupProjectHoverEvents,
  syncModerationCityFromOverlay,
  applySelectionOutline,
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
  checkOverlaySizeAndWarn,
} from "@/services/overlay/overlayMarkers";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import type { OverlayObject, OverlayData } from "@/types/index";

/**
 * Create a Leaflet overlay on the map
 * @param onAddedToMap - Optional callback invoked when overlay is successfully added to map
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
    // Get corners with edit mode cache awareness for position persistence
    const corners = getCornersForOverlayWithCache(overlayObject);

    // Convert corners to Leaflet LatLng objects if available
    const leafletCorners = corners
      ? corners.map((corner) => L.latLng(corner.lat, corner.lng))
      : undefined;
    const isEditMode = overlayStore.mode === "edit";

    // Suppress the built-in leaflet-toolbar popup — OverlayFloatingToolbar.vue handles the UI.
    // Keep mode actions so editing handles (resize/distort) still work in edit mode.
    const newOverlay = L.distortableImageOverlay(imageUrl, {
      editable: true,
      keyboard: false,
      suppressToolbar: true,
      // L.ResizeRotateAction / L.DistortAction are registered by leaflet-distortableimage at runtime.
      actions: (isEditMode
        ? [(L as any).ResizeRotateAction, (L as any).DistortAction]
        : []) as any[],
      corners: leafletCorners,
      dragBehavior: "auto",
      selectOnDrag: false,
      draggable: isEditMode,
      // CRITICAL: Only enable credentials for local backend URLs (pending images).
      // R2 CDN URLs don't support credentials and will fail if crossOrigin is set.
      crossOrigin: imageRequiresCredentials(imageUrl) ? "use-credentials" : undefined,
      mode: "resizeRotate",
    });

    // Register immediately so mode-switch cleanup (registry.clearEntry) can remove this
    // layer even before the zoom animation completes or the image loads.
    registry.setLayer(overlayObject.id, newOverlay);

    setupOverlayEventHandlers(newOverlay, overlayObject);

    setupOverlayLoadHandler(newOverlay, overlayObject, onAddedToMap);

    // Always add overlay to map - visibility based on zoom is handled by useOverlayZoomHandler
    // This waits for any ongoing zoom animation to complete before adding to prevent visual glitches
    const addOverlayWhenReady = () => {
      const currentZoom = map.value.getZoom();
      const shouldShowImage =
        currentZoom >= getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);

      // Only add to map if zoom is appropriate (zoom handler will manage later changes)
      if (shouldShowImage) {
        // CRITICAL FIX: Re-verify visibility before adding (async race condition protection)
        // The mode might have changed while waiting for zoom animation (View -> Edit -> View)
        const authStore = useAuthStore();
        if (!isOverlayVisible(overlayObject, overlayStore.mode, authStore.user?.id)) {
          // Abort: clear the layer we registered above and release the creation mutex
          registry.clearLayer(overlayObject.id);
          registry.cancelCreation(overlayObject.id);
          return;
        }

        // CRITICAL: Check if already on map to prevent duplicates
        // This can happen when renderFullOverlays is called multiple times before onAddedToMap callback completes
        if (map.value.hasLayer(newOverlay)) {
          return;
        }

        newOverlay.addTo(map.value);
      } else {
        // Zoom is too low — layer won't be added. Clear registry ref and release mutex.
        registry.clearLayer(overlayObject.id);
        registry.cancelCreation(overlayObject.id);
      }
    };

    // Check if map is currently zooming, _animatingZoom isn't documented for some reason
    if (map.value._animatingZoom) {
      // Wait for zoom animation to complete
      map.value.once("zoomend", addOverlayWhenReady);
    } else {
      // No animation - add immediately if zoom is appropriate
      addOverlayWhenReady();
    }

    return newOverlay;
  } catch (error) {
    console.error("Failed to create overlay:", error);
    return null;
  }
}

/**
 * Queue for progressive overlay initialization to prevent main thread blocking
 * Maps OverlayID -> Initialization Callback
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

  // Process up to 2 overlays per frame
  // This prevents "Animation frame fired" blocks in performance profile
  // caused by simultaneous completion of multiple image loads (cache burst)
  let processedCount = 0;
  const BATCH_SIZE = 2;

  for (const [id, initFn] of initQueue) {
    if (processedCount >= BATCH_SIZE) break;

    // Execute initialization
    initFn();

    // Remove from queue
    initQueue.delete(id);
    processedCount += 1;
  }

  // Continue in next frame
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
 * Handle overlay load event with all initialization logic
 */
function setupOverlayLoadHandler(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
  onReady?: () => void,
): void {
  const element = overlay.getElement();
  if (!element) {
    // Element should be available immediately after addTo(), but add minimal fallback
    requestAnimationFrame(() => {
      setupOverlayLoadHandler(overlay, overlayObject, onReady);
    });
    return;
  }

  let isInitialized = false;

  const tryInit = () => {
    if (isInitialized) {
      return;
    }

    const hasLayer = map.value.hasLayer(overlay);

    // Guard: Only proceed if overlay is still on map (prevents errors during rapid viewport changes)
    if (!hasLayer) {
      return;
    }

    if (element.complete && element.naturalWidth > 0) {
      isInitialized = true;

      // Cleanup listeners to prevent redundant calls
      L.DomEvent.off(element, "load", tryInit);
      overlay.off("add", tryInit);

      // CRITICAL OPTIMIZATION: Schedule initialization instead of running synchronously
      // This fixes the "lag spike" when multiple cached images load simultaneously
      scheduleInitialization(overlayObject.id, () => {
        // Re-check existence before running (user might have panned away)
        if (map.value.hasLayer(overlay)) {
          onOverlayLoaded(overlayObject, onReady);
        } else {
          // Layer was removed from map (e.g. mode switch) before image loaded
          // Clean up tracking to allow future re-creation
          registry.cancelCreation(overlayObject.id);
        }
      });
    }
  };

  L.DomEvent.on(element, "load", tryInit);

  // CRITICAL FIX: Also check when added to map
  // This handles the case where the image loads while waiting for zoom animation (flyTo)
  // In that case, the 'load' event fires while hasLayer() is false, so we missed it.
  // When 'add' fires later, we check again.
  overlay.on("add", tryInit);

  // Handle load errors to ensure system consistency
  L.DomEvent.on(element, "error", () => {
    console.warn("Overlay image failed to load:", overlayObject.id);
    initQueue.delete(overlayObject.id); // Cancel pending init if error
    registry.cancelCreation(overlayObject.id);
    // Execute callback even on error so the overlay is registered in the store
    // This prevents it from being stuck in a "rendering" state without a store entry
    if (onReady) {
      onReady();
    }
  });

  // Check immediately in case it's already loaded and on map
  tryInit();
}

/**
 * Handle all logic when overlay finishes loading
 */
function onOverlayLoaded(overlayObject: OverlayObject, onReady?: () => void): void {
  const overlayStore = useOverlayStore();
  const layer = registry.getLayer(overlayObject.id);
  if (!layer) return;

  updateMarkerPosition(overlayObject);

  initializeOverlayHistory(overlayObject);

  updateMarkerTooltip(overlayObject);

  // Check size validation for overlays in edit mode
  if (overlayStore.mode === "edit") {
    checkOverlaySizeAndWarn(layer, overlayObject);
  }

  // Setup hover events for project highlighting after element is available
  setupProjectHoverEvents(layer, overlayObject);

  // CRITICAL: Setup movement tracking AFTER overlay is loaded and has a DOM element
  // This must be called here (not in setupOverlayEventHandlers) because overlay.getElement()
  // returns null until the overlay is added to the map and the image loads
  setupOverlayMovementTracking(layer, overlayObject);

  // Ensure new overlays start with no outline unless they're selected
  if (overlayStore.idSelectedOverlay !== overlayObject.id) {
    const element = layer.getElement();
    if (element) {
      element.style.boxShadow = "";
      element.style.outline = "none";
    }
  } else {
    // Overlay finished loading while already selected (out-of-viewport navigation):
    // applyOutlineAfterImageLoad ran before the layer existed so no listener was set.
    // Apply the outline now that the image is fully loaded and in the DOM.
    applySelectionOutline(overlayObject);
  }

  // Invoke the caller's callback now that the overlay is fully initialized
  if (onReady) {
    onReady();
  }
}

/**
 * Setup overlay event handlers for selection, deselection, and editing
 */
function setupOverlayEventHandlers(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
): void {
  const overlayStore = useOverlayStore();

  overlay.on("select", () => {
    // In moderation mode, clicking a contribution should load the city context
    // This ensures clicking the image itself (not just the marker) loads the city
    syncModerationCityFromOverlay(overlayObject);

    // Use centralized selection function for consistent behavior
    selectOverlay(overlayObject.id);
  });

  overlay.on("deselect", () => {
    // Only handle deselect for the overlay that was actually selected
    if (overlayStore.idSelectedOverlay === overlayObject.id) {
      // Use centralized selection function (null = deselect all)
      selectOverlay(null);

      // Hide InfoPopup when overlay is deselected
      if (overlayStore.showInfoPopup) {
        overlayStore.hideInfoPopup();
      }
    }
  });

  // Listens to the map being moved
  overlay.on("dragend", () => {
    // Re-validate size after drag — isTooBig may be stale from a previous edit/undo
    checkOverlaySizeAndWarn(overlay, overlayObject);
    saveToHistory(overlayObject);
  });

  // listens to individual corners being moved
  overlay.on("edit", () => {
    // Handle transition from backend to local copy when edited
    updateMarkerPosition(overlayObject);

    // Validate overlay size in real-time
    checkOverlaySizeAndWarn(overlay, overlayObject);

    saveToHistory(overlayObject);
  });

  // NOTE: setupOverlayMovementTracking is called in onOverlayLoaded() instead of here
  // because the overlay element doesn't exist until after the overlay is added to the map
  // and the image finishes loading
}

/**
 * Set up additional movement tracking for overlays (real-time updates during manipulation)
 */
function setupOverlayMovementTracking(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
): void {
  // Set up DOM event listeners for continuous marker position updates during manipulation
  const element = overlay.getElement();

  if (element) {
    let isManipulating = false;
    let updateFrame: number | null = null;
    let hasActuallyMoved = false;

    // Stop tracking handler - behaves like 'mouseup'/'touchend'
    function stopTracking() {
      const overlayStore = useOverlayStore();

      if (!isManipulating) return;
      isManipulating = false;

      if (updateFrame) {
        cancelAnimationFrame(updateFrame);
        updateFrame = null;
      }

      // Clean up document listeners immediately when drag ends
      // This prevents memory leaks and piling up listeners
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("mousemove", onMovement);
      document.removeEventListener("touchmove", onMovement);

      if (hasActuallyMoved) {
        updateMarkerPosition(overlayObject);
        updateOverlayMarkersColors(overlayStore.overlays, overlayStore.mode, overlayObject.id);
      }
    }

    // Update loop for smooth animation
    function performUpdate() {
      if (isManipulating) {
        updateMarkerPosition(overlayObject);
        hasActuallyMoved = true;
        updateFrame = requestAnimationFrame(performUpdate);
      }
    }

    // Event handlers using hoisted functions for proper scoping
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

    // Start tracking handler - behaves like 'mousedown'/'touchstart'
    function startTracking() {
      if (isManipulating) return;
      isManipulating = true;
      hasActuallyMoved = false;

      // Add document listeners ONLY when tracking starts
      document.addEventListener("mouseup", onMouseUp);
      document.addEventListener("touchend", onTouchEnd);
      document.addEventListener("mousemove", onMovement);
      document.addEventListener("touchmove", onMovement, { passive: true });

      // We don't start the loop here immediately; we wait for the first move event
      // This avoids running the loop just for a click
    }

    // Track mouse and touch events on the element itself to start the process
    element.addEventListener("mousedown", startTracking);
    element.addEventListener("touchstart", startTracking, { passive: true });
  }
}

/**
 * Render backend CDN overlays on the map for view mode.
 * Returns true if at least one overlay render was actually started (beginCreation succeeded).
 * Returns false if all overlays were skipped (already rendering, already ready, zoom too low).
 * Callers that pass an onReady callback should only fall back to polling if this returns false.
 */
export function renderViewModeOverlays(
  viewModeOverlays: OverlayData[],
  createMarkers = true,
  forceRerender = false,
  onReady?: () => void,
): boolean {
  const overlayStore = useOverlayStore();

  let overlaysToRender: OverlayData[] = [];

  if (forceRerender) {
    // Force re-render all overlays (for city switching)
    overlaysToRender = viewModeOverlays;
  } else {
    // Render overlays that either:
    // 1. Don't exist in the store yet (new overlays)
    // 2. Exist but have null Leaflet layer (need re-rendering after zoom out)
    overlaysToRender = viewModeOverlays.filter((cdnOverlay) => {
      if (!overlayStore.overlays[cdnOverlay.id]) return true; // New overlay
      return !registry.hasReadyLayer(cdnOverlay.id); // Needs re-rendering after zoom out
    });
  }

  let anyStarted = false;
  for (const cdnOverlay of overlaysToRender) {
    if (renderSingleOverlay(cdnOverlay, createMarkers, onReady)) {
      anyStarted = true;
    }
  }

  return anyStarted;
}

/**
 * Render a single CDN overlay as read-only distortable overlay on the map.
 * Returns true if creation was actually started (beginCreation succeeded), false otherwise.
 */
function renderSingleOverlay(
  cdnOverlay: OverlayData,
  createMarkers = true,
  onReady?: () => void,
): boolean {
  const overlayStore = useOverlayStore();

  // Skip replaced overlays - their images are deleted and would cause 404 errors
  if (cdnOverlay.status === "replaced") {
    return false;
  }

  // CRITICAL: Skip overlays that shouldn't be visible in the current mode.
  // This catches race conditions where renderViewModeOverlays was queued during one mode
  // but executes after a mode switch (e.g. pending overlay queued during edit mode,
  // but mode switched to view before the async callback fires).
  const authStore = useAuthStore();
  if (!isOverlayVisible(cdnOverlay, overlayStore.mode, authStore.user?.id)) {
    return false;
  }

  // beginCreation atomically checks + prevents duplicate layers:
  //   - returns false if already has a ready layer (re-render not needed)
  //   - returns false if already being created (concurrent call guard)
  if (!registry.beginCreation(cdnOverlay.id)) {
    return false;
  }

  const existingOverlay = overlayStore.overlays[cdnOverlay.id];

  // Always use backend data to create overlay object (cached positions applied later via applyPositionToOverlay)
  const overlayObject = createOverlayObject(cdnOverlay);

  // Preserve UI state (like view choice) from existing store object if re-rendering
  if (existingOverlay) {
    overlayObject.isViewingApprovedPosition = existingOverlay.isViewingApprovedPosition;
  }

  if (createMarkers) {
    createSingleMarker(overlayObject);
  }

  const overlayObjectWithMethods = enrichOverlayWithProject(overlayObject);

  // onOverlayFullyLoaded is passed as a callback but only fires asynchronously — after
  // the image has loaded and Leaflet has completed its setup. It is intentionally defined
  // after createLeafletOverlay() to keep the reading order logical (caller before callback);
  // hoisting makes it available to pass as an argument above its definition.
  const newOverlay = createLeafletOverlay(
    overlayObjectWithMethods.imageUrl,
    overlayObjectWithMethods,
    onOverlayFullyLoaded,
  );

  if (!newOverlay) {
    // Creation failed - release the creation mutex
    registry.cancelCreation(cdnOverlay.id);
    return false;
  }

  // registry.setLayer was called inside createLeafletOverlay, so mode-switch cleanup
  // (registry.clearEntry) can already find and remove this layer.
  // Register overlay data in the store ONLY after the image has loaded and Leaflet is done.
  function onOverlayFullyLoaded() {
    // CRITICAL: Check if overlay should still be visible in the current mode.
    // The mode may have changed during async image loading (e.g. Edit → View switch
    // while a pending overlay's image was still loading).
    const authStore = useAuthStore();
    const visible = isOverlayVisible(
      overlayObjectWithMethods,
      overlayStore.mode,
      authStore.user?.id,
    );
    if (!visible) {
      const layer = registry.getLayer(cdnOverlay.id);
      if (layer && map.value.hasLayer(layer)) layer.remove();
      registry.clearLayer(cdnOverlay.id);
      registry.cancelCreation(cdnOverlay.id);
      return;
    }

    const marker = registry.getMarker(cdnOverlay.id);
    // Marker may be gone if the user panned away or mode switched before image loaded
    if (!marker) {
      const layer = registry.getLayer(cdnOverlay.id);
      if (layer && map.value.hasLayer(layer)) layer.remove();
      registry.clearLayer(cdnOverlay.id);
      registry.cancelCreation(cdnOverlay.id);
      return;
    }

    // Safety net: re-add the marker if it was removed from the map
    // during a zoom-out cleanup before the image finished loading.
    if (!map.value.hasLayer(marker)) {
      marker.addTo(map.value);
    }

    overlayStore.addOverlay(cdnOverlay.id, overlayObjectWithMethods);

    // Update the tooltip here rather than in createSingleMarker, because the mode may have
    // changed during the async image load (e.g. a View -> Edit switch mid-navigation).
    updateMarkerTooltip(overlayObjectWithMethods);

    registry.cancelCreation(cdnOverlay.id);

    // A standalone project marker may have been shown for this project while its overlays
    // were pending/invisible. Remove it now that a real overlay is on the map.
    if (cdnOverlay.projectId) {
      removeStandaloneProjectMarkerForProject(cdnOverlay.projectId);
    }

    // Notify caller that this overlay is fully ready on the map
    onReady?.();
  }

  // Creation was successfully started — onReady is wired; caller should NOT fall back to polling.
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
