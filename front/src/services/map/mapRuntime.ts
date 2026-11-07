// Application resources tied to a MapLibre instance and released while it is still alive.
// Application state (overlay store, focus, history, preferences) outlives any one map.
import { watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useOverlayStore } from "@/stores/overlayStore";
import type { Map as MaplibreMap } from "maplibre-gl";
import { mapRotationEnabled } from "@/services/core/settings";
import { setupEventListeners } from "@/services/map/viewportTriggers";
import { addTileLayer } from "@/services/map/tiles/basemap";
import { initVectorTileSync } from "@/services/map/tiles/sync";
import {
  startMapStateCoordinator,
  activateMapStateCoordinator,
} from "@/services/map/globalWatchers";
import { clearPreviewShapes } from "@/services/map/shapes/rendering";
import { hideEditHandles, refreshEditHandlesGeometry } from "@/services/overlay/editing";
import { hideCropHandles } from "@/services/overlay/cropHandles";
import {
  clearMapObjectRegistry,
  installOverlayStyleSwitchHandling,
} from "@/services/overlay/mapLayers";
import { stopShapeEditing } from "@/services/shape/shapeEditorLazy";
import { getMapOrNull, onMapReady, onStyleSwitch } from "@/services/core/map";
import { createViewportRenderLoop } from "@/services/map/viewportRenderLoop";

// Toggling the rotation setting locks/unlocks drag-rotate, pitch-with-rotate and two-finger touch
// pitch; locking also snaps the camera back to north so the map never stays stuck at an angle.
function watchRotationSetting(target: MaplibreMap): () => void {
  function applyRotation(enabled: boolean): void {
    if (enabled) {
      target.dragRotate.enable();
      target.touchZoomRotate.enableRotation();
      target.touchPitch.enable();
      return;
    }
    target.dragRotate.disable();
    target.touchZoomRotate.disableRotation();
    target.touchPitch.disable();
    target.resetNorthPitch();
  }

  return watch(mapRotationEnabled, applyRotation);
}

function clearMapObjects(): void {
  stopShapeEditing();
  hideCropHandles();
  hideEditHandles();
  clearMapObjectRegistry();
  clearPreviewShapes();
}

/**
 * Bind the instance-scoped behaviour to `target`. The teardown must run
 * before the map is removed: it hands every map object back to the still-live instance.
 */
export function startMapRuntime(target: MaplibreMap) {
  const authStore = useAuthStore();
  const renderLoop = createViewportRenderLoop(target, refreshEditHandlesGeometry);
  const stops: (() => void)[] = [];
  let stopped = false;

  function stopMapRuntime(): void {
    if (stopped) return;
    stopped = true;
    renderLoop.stop();
    for (const stop of stops.toReversed()) stop();
    if (getMapOrNull() === target) {
      clearMapObjects();
      // Tile membership belongs to this viewport; selected tile data, drafts and
      // the retained mode session remain in application state for a later map.
      useOverlayStore().replaceTileOverlays(new Map());
    }
  }

  try {
    useOverlayStore().replaceTileOverlays(new Map());
    // Register each disposer before starting the next resource, so startup failure
    // can release the resources that were already acquired.
    // oxlint-disable unicorn/prefer-single-call
    stops.push(watchRotationSetting(target));
    // Remove the previous account's map objects immediately, including active editing gestures.
    stops.push(
      watch(
        () => authStore.user?.id,
        () => {
          clearMapObjects();
          renderLoop.run();
        },
        { flush: "sync" },
      ),
    );
    stops.push(setupEventListeners(target, renderLoop.run));
    stops.push(installOverlayStyleSwitchHandling());
    stops.push(
      onStyleSwitch((phase) => {
        if (phase === "after") renderLoop.run();
      }),
    );
    stops.push(startMapStateCoordinator(renderLoop.run));
    stops.push(
      onMapReady((readyMap) => {
        if (readyMap !== target || stopped) return;
        stops.push(initVectorTileSync(target));
        activateMapStateCoordinator(target);
        renderLoop.run();
      }),
    );
    stops.push(addTileLayer());
    // oxlint-enable unicorn/prefer-single-call
  } catch (error) {
    stopMapRuntime();
    throw error;
  }

  return { renderOverlays: renderLoop.run, stop: stopMapRuntime };
}
