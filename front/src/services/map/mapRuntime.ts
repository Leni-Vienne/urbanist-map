// Everything a single MapLibre instance owns while MapView holds it: the watchers and listeners
// bound to that instance, and the map-object registries filled against it. Started right after the
// map is created and stopped, in reverse, while it is still alive. Application state (overlay store,
// focus, history, preferences) is deliberately untouched: it outlives any one map.
import { watch } from "vue";
import type { Map as MaplibreMap } from "maplibre-gl";
import { mapRotationEnabled } from "@/services/core/settings";
import { setupEventListeners, clearMapSessionData } from "@/services/map/viewportTriggers";
import { clearPendingProjectSourceCache } from "@/services/map/tiles/basemap";
import { clearHybridInteractionHandlers } from "@/services/map/tiles/layers";
import { clearPreviewShapes } from "@/services/map/shapes/rendering";
import { clearHoverPreview } from "@/services/map/hoverPreviewState";
import { hideEditHandles } from "@/services/overlay/editing";
import { hideCropHandles } from "@/services/overlay/cropHandles";
import { clearOverlayRenderObjects } from "@/services/overlay/teardown";
import { installOverlayStyleSwitchHandling } from "@/services/overlay/mapLayers";

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

/**
 * Bind the instance-scoped behaviour to `target` and return its teardown. The teardown must run
 * before the map is removed: it hands every map object back to the still-live instance.
 */
export function startMapRuntime(target: MaplibreMap): () => void {
  const stops = [
    watchRotationSetting(target),
    setupEventListeners(target),
    installOverlayStyleSwitchHandling(),
  ];

  return function stopMapRuntime(): void {
    // Active gestures own map objects and hold their own listeners, so they end first.
    hideCropHandles();
    hideEditHandles();

    for (const stop of stops.toReversed()) stop();

    clearOverlayRenderObjects();
    clearPreviewShapes();
    clearHoverPreview();

    // Session sets and the pending-source payloads replayed onto a style are re-fetched by the next
    // mount, which must not inherit this one's content.
    clearMapSessionData();
    clearPendingProjectSourceCache();
    clearHybridInteractionHandlers(target);
  };
}
