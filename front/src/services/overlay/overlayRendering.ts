// Leaflet overlay rendering and DOM manipulation
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
// existing map, we must apply it manually here.
if (!L.DomUtil.hasClass(map.value.getContainer(), "ldi")) {
  L.DomUtil.addClass(map.value.getContainer(), "ldi");
}
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import { updateOverlayMarkersColors } from "@/services/map/markers";
import { imageRequiresCredentials } from "@/utils/imageUrl";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { createOverlayObject } from "@/utils/typeFactories";
import { removeStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import { selectOverlay, setupProjectHoverEvents } from "@/services/overlay/overlaySelection";
import {
  initializeOverlayHistory,
  getCornersForOverlay,
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
import { createRafBatchQueue } from "@/utils/rafBatchQueue";
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
  const mapStore = useMapStore();

  if (!overlayObject) return null;

  overlayObject.imageUrl = imageUrl;

  try {
    const corners = getCornersForOverlay(overlayObject);

    const leafletCorners = corners
      ? corners.map((corner) => L.latLng(corner.lat, corner.lng))
      : undefined;
    const isEditMode = mapStore.mode === "edit";
    // Suppress the built-in leaflet-toolbar popup, OverlayFloatingToolbar.vue handles the UI.
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
      // Only enable credentials for local backend URLs (pending images).
      // R2 CDN URLs don't support credentials and will fail if crossOrigin is set.
      crossOrigin: imageRequiresCredentials(imageUrl) ? "use-credentials" : undefined,
      mode: "resizeRotate",
      // Prevent Geoman (shape editor) from snapping to distortable overlays.
      // DistortableImageOverlay extends L.ImageOverlay, so Geoman's snap builder would try
      // L.rectangle(overlay.getBounds()), but getBounds() returns an empty LatLngBounds
      // (with _northEast = undefined) before the image loads, causing a crash.
      snapIgnore: true,
      cornersOrder: "clockwise", // Ensure corners are always in [NW, NE, SE, SW] order for consistency with backend and UI (e.g. tooltip) logic
    });

    // Register immediately so mode-switch cleanup (registry.clearEntry) can remove this
    // layer even before the zoom animation completes or the image loads.
    registry.setLayer(overlayObject.id, newOverlay);

    setupOverlayEventHandlers(newOverlay, overlayObject);

    // Always add overlay to map - visibility based on zoom is handled by useOverlayZoomHandler.
    // Waits for any ongoing zoom animation to complete before adding to prevent visual glitches.
    const addOverlayWhenReady = () => {
      const currentZoom = map.value.getZoom();
      const shouldShowImage =
        currentZoom >= getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);

      // Only add to map if zoom is appropriate (zoom handler will manage later changes)
      if (shouldShowImage) {
        // Re-verify visibility before adding: the mode might have changed
        // while waiting for the zoom animation (View -> Edit -> View).
        const authStore = useAuthStore();
        if (!isOverlayVisible(overlayObject, mapStore.mode, authStore.user?.id)) {
          // Abort: clear the layer we registered above and release the creation mutex
          registry.clearLayer(overlayObject.id);
          registry.cancelCreation(overlayObject.id);
          return;
        }

        newOverlay.addTo(map.value);
        // getElement() is non-null after addTo, so setupOverlayLoadHandler can run synchronously.
        setupOverlayLoadHandler(newOverlay, overlayObject, onAddedToMap);

        // Keep the currently-selected overlay on top of this new one.
        const overlayStore = useOverlayStore();
        if (overlayStore.idSelectedOverlay && overlayStore.idSelectedOverlay !== overlayObject.id) {
          const selectedLayer = registry.getLayer(overlayStore.idSelectedOverlay);
          if (selectedLayer) {
            requestAnimationFrame(() => {
              selectedLayer.bringToFront();
            });
          }
        }
      } else {
        // Zoom is too low, layer won't be added. Clear registry ref and release mutex.
        registry.clearLayer(overlayObject.id);
        registry.cancelCreation(overlayObject.id);
      }
    };

    // _animatingZoom is undocumented but reliably set during zoom animations.
    if (map.value._animatingZoom) {
      map.value.once("zoomend", addOverlayWhenReady);
    } else {
      addOverlayWhenReady();
    }

    return newOverlay;
  } catch (error) {
    console.error("Failed to create overlay:", error);
    // Drop the registry ref so pruneOverlays won't later try to re-add a broken layer.
    registry.clearLayer(overlayObject.id);
    return null;
  }
}

// Cap batch size at 2 so a cache-burst of simultaneous image loads doesn't
// produce long "Animation frame fired" blocks in the performance profile.
const initQueue = createRafBatchQueue<() => void>((initFn) => initFn(), 2);

function scheduleInitialization(id: string, initFn: () => void) {
  initQueue.enqueue(id, initFn);
}

function setupOverlayLoadHandler(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
  onReady?: () => void,
): void {
  const element = overlay.getElement();
  if (!element) {
    console.warn("Overlay element missing at setupOverlayLoadHandler:", overlayObject.id);
    registry.cancelCreation(overlayObject.id);
    return;
  }

  let isInitialized = false;

  const tryInit = () => {
    if (isInitialized || !map.value.hasLayer(overlay)) return;
    if (!element.complete || element.naturalWidth === 0) return;

    isInitialized = true;
    L.DomEvent.off(element, "load", tryInit);

    // Batch so a cache-burst of simultaneous loads doesn't produce a long frame.
    scheduleInitialization(overlayObject.id, () => {
      if (map.value.hasLayer(overlay)) {
        onOverlayLoaded(overlayObject, onReady);
      } else {
        registry.cancelCreation(overlayObject.id);
      }
    });
  };

  L.DomEvent.on(element, "load", tryInit);
  L.DomEvent.on(element, "error", () => {
    console.warn("Overlay image failed to load:", overlayObject.id);
    registry.cancelCreation(overlayObject.id);
    onReady?.();
  });

  // Defer one frame so the lib's own load handler runs first (populates _corners
  // for overlays created without preset corners).
  requestAnimationFrame(tryInit);
}

function onOverlayLoaded(overlayObject: OverlayObject, onReady?: () => void): void {
  const mapStore = useMapStore();
  const layer = registry.getLayer(overlayObject.id);
  if (!layer) return;

  updateMarkerPosition(overlayObject);
  initializeOverlayHistory(overlayObject);
  updateMarkerTooltip(overlayObject);

  if (mapStore.mode === "edit") {
    checkOverlaySizeAndWarn(layer, overlayObject);
  }

  setupProjectHoverEvents(layer, overlayObject);

  // Movement tracking must run here, not in setupOverlayEventHandlers:
  // overlay.getElement() returns null until the image has loaded.
  setupOverlayMovementTracking(layer, overlayObject);

  if (onReady) {
    onReady();
  }
}

function setupOverlayEventHandlers(
  overlay: L.DistortableImageOverlay,
  overlayObject: OverlayObject,
): void {
  const overlayStore = useOverlayStore();

  overlay.on("select", () => {
    selectOverlay(overlayObject.id);
  });

  overlay.on("deselect", () => {
    if (overlayStore.idSelectedOverlay === overlayObject.id) {
      selectOverlay(null); // null = deselect all
      if (overlayStore.showInfoPopup) {
        overlayStore.hideInfoPopup();
      }
    }
  });

  // Whole overlay dragged.
  overlay.on("dragend", () => {
    // isTooBig may be stale from a prior edit/undo, re-validate.
    checkOverlaySizeAndWarn(overlay, overlayObject);
    saveToHistory(overlayObject);
  });

  // Individual corner dragged.
  overlay.on("edit", () => {
    updateMarkerPosition(overlayObject);
    checkOverlaySizeAndWarn(overlay, overlayObject);
    saveToHistory(overlayObject);
  });
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
      const mapStore = useMapStore();

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
        updateOverlayMarkersColors(overlayStore.overlays, mapStore.mode, overlayObject.id);
      }
    }

    function performUpdate() {
      if (isManipulating) {
        updateMarkerPosition(overlayObject);
        hasActuallyMoved = true;
        updateFrame = requestAnimationFrame(performUpdate);
      }
    }

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

      document.addEventListener("mouseup", onMouseUp);
      document.addEventListener("touchend", onTouchEnd);
      document.addEventListener("mousemove", onMovement);
      document.addEventListener("touchmove", onMovement, { passive: true });

      // The update loop starts on the first mousemove rather than here,
      // so a plain click doesn't spin up an rAF loop for nothing.
    }

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
  onReady?: () => void,
): boolean {
  // renderSingleOverlay's beginCreation gate handles "already rendered" and "in flight".
  let anyStarted = false;
  for (const cdnOverlay of viewModeOverlays) {
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
  const mapStore = useMapStore();

  // Skip replaced overlays - their images are deleted and would cause 404 errors
  if (cdnOverlay.status === "replaced") {
    return false;
  }

  // Catch the race where renderViewModeOverlays was queued under one mode but
  // executes after a mode switch (e.g. pending overlay queued in edit mode,
  // but mode switched to view before the async callback fires).
  const authStore = useAuthStore();
  if (!isOverlayVisible(cdnOverlay, mapStore.mode, authStore.user?.id)) {
    return false;
  }

  // beginCreation atomically checks + prevents duplicate layers:
  //   - returns false if already has a ready layer (re-render not needed)
  //   - returns false if already being created (concurrent call guard)
  if (!registry.beginCreation(cdnOverlay.id)) {
    return false;
  }

  const existingOverlay = overlayStore.overlays[cdnOverlay.id];

  // Always use backend data to create overlay object.
  const overlayObject = createOverlayObject(cdnOverlay);

  // Preserve in-progress edit state when re-rendering. history.at(-1) is the user's last
  // edited position; without this carryover the layer would snap back to backend corners
  // on any round-trip (e.g. edit -> view -> edit) since the fresh object has empty history.
  // Shallow-clone the arrays so the new and existing OverlayObjects don't share references
  // during the async window before addOverlay() replaces the store entry.
  if (existingOverlay) {
    overlayObject.isViewingApprovedPosition = existingOverlay.isViewingApprovedPosition;
    overlayObject.history = [...existingOverlay.history];
    overlayObject.redoStack = [...existingOverlay.redoStack];
    overlayObject.isModified = existingOverlay.isModified;
  }

  if (createMarkers) {
    createSingleMarker(overlayObject);
  }

  const overlayObjectWithMethods = enrichOverlayWithProject(overlayObject);

  // onOverlayFullyLoaded is hoisted below; it fires async once the image is loaded.
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

  // registry.setLayer was already called inside createLeafletOverlay so mode-switch
  // cleanup can find this layer; we only register store data once the image is loaded.
  function onOverlayFullyLoaded() {
    // The mode may have changed during async image loading (e.g. Edit -> View
    // while a pending overlay's image was still in flight).
    const visible = isOverlayVisible(overlayObjectWithMethods, mapStore.mode, authStore.user?.id);
    if (!visible) {
      const layer = registry.getLayer(cdnOverlay.id);
      if (layer && map.value.hasLayer(layer)) layer.remove();
      registry.clearLayer(cdnOverlay.id);
      registry.cancelCreation(cdnOverlay.id);
      return;
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

    onReady?.();
  }

  // Creation was successfully started, onReady is wired; caller should NOT fall back to polling.
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
