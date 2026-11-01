// Application resources tied to a MapLibre instance and released while it is still alive.
// Application state (overlay store, focus, history, preferences) outlives any one map.
import { watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import type { Map as MaplibreMap } from "maplibre-gl";
import { mapRotationEnabled } from "@/services/core/settings";
import { setupEventListeners } from "@/services/map/viewportTriggers";
import { clearPendingProjectSourceCache } from "@/services/map/tiles/basemap";
import { clearPreviewShapes } from "@/services/map/shapes/rendering";
import { hideEditHandles, refreshEditHandlesGeometry } from "@/services/overlay/editing";
import { hideCropHandles } from "@/services/overlay/cropHandles";
import {
  clearMapObjectRegistry,
  installOverlayStyleSwitchHandling,
} from "@/services/overlay/mapLayers";
import { stopShapeEditing } from "@/services/shape/shapeEditorLazy";
import { onStyleSwitch } from "@/services/core/map";
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

  const stops = [
    watchRotationSetting(target),
    // Remove the previous account's map objects immediately, including active editing gestures.
    watch(
      () => authStore.user?.id,
      () => {
        clearMapObjects();
        renderLoop.run();
      },
      { flush: "sync" },
    ),
    setupEventListeners(target, renderLoop.run),
    installOverlayStyleSwitchHandling(),
    onStyleSwitch((phase) => {
      if (phase === "after") renderLoop.run();
    }),
  ];

  function stopMapRuntime(): void {
    renderLoop.stop();
    for (const stop of stops.toReversed()) stop();
    clearMapObjects();

    // Pending-source payloads belong to this MapLibre instance. The application session snapshot
    // survives so the next map can project it without another backend request.
    clearPendingProjectSourceCache();
  }

  return { renderOverlays: renderLoop.run, stop: stopMapRuntime };
}
