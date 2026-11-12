// Application resources tied to a MapLibre instance and released while it is still alive.
// Application state (overlay store, focus, history, preferences) outlives any one map.
import { effectScope, onScopeDispose, watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import type { Map as MaplibreMap } from "maplibre-gl";
import { mapRotationEnabled } from "@/services/core/settings";
import { syncSessionDataForMode } from "@/services/map/viewportTriggers";
import { useContributionStore } from "@/stores/contributionStore";
import { useMapSessionStore } from "@/stores/mapSessionStore";
import { startBasemap } from "@/services/map/tiles/basemap";
import { initVectorTileSync } from "@/services/map/tiles/sync";
import { watchMarkerColors } from "@/services/overlay/markers";
import {
  renderMapSessionPendingSources,
  watchPendingProjectSources,
} from "@/services/map/tiles/pendingSources";
import {
  watchTileLayerState,
  syncTileLayerState,
  syncModeVectorFilters,
} from "@/services/map/tiles/layers";
import { watchMapAreaOutline } from "@/services/map/mapAreaOutline";
import { watchProjectShapePreview } from "@/services/map/shapes/previewCoordinator";
import { clearPreviewShapes } from "@/services/map/shapes/rendering";
import {
  hideEditHandles,
  refreshEditHandlesGeometry,
  watchEditHandles,
} from "@/services/overlay/editing";
import { hideCropHandles } from "@/services/overlay/cropHandles";
import {
  clearMapObjectRegistry,
  installOverlayStyleSwitchHandling,
} from "@/services/overlay/mapLayers";
import { getMapOrNull, onStyleSwitch } from "@/services/core/map";
import {
  createViewportRenderLoop,
  watchOverlayReconciliation,
} from "@/services/map/viewportRenderLoop";

// Toggling the rotation setting locks/unlocks drag-rotate, pitch-with-rotate and two-finger touch
// pitch; locking also snaps the camera back to north so the map never stays stuck at an angle.
function watchRotationSetting(target: MaplibreMap): void {
  function applyRotation(enabled: boolean): void {
    if (enabled) {
      target.dragRotate.enable({ movement: "linear" });
      target.touchZoomRotate.enableRotation();
      target.touchPitch.enable();
      return;
    }
    target.dragRotate.disable();
    target.touchZoomRotate.disableRotation();
    target.touchPitch.disable();
    target.resetNorthPitch();
  }

  watch(mapRotationEnabled, applyRotation);
}

function clearMapObjects(): void {
  useUiStore().closeEditor("shape");
  hideCropHandles();
  hideEditHandles();
  clearMapObjectRegistry();
  clearPreviewShapes();
}

/** Own reactive watchers and external resources until MapView removes the still-live map. */
export function startMapRuntime(target: MaplibreMap): () => void {
  const authStore = useAuthStore();
  const uiStore = useUiStore();
  const scope = effectScope(true);
  const renderLoop = createViewportRenderLoop(target, refreshEditHandlesGeometry);

  try {
    scope.run(() => {
      onScopeDispose(() => {
        renderLoop.stop();
        if (getMapOrNull() === target) {
          clearMapObjects();
          // Viewport membership expires; selected data, drafts and mode sessions survive remounts.
          useOverlayStore().replaceTileOverlays(new Map());
        }
      });
      useOverlayStore().replaceTileOverlays(new Map());
      watchRotationSetting(target);
      watch(
        () => authStore.user?.id,
        () => {
          clearMapObjects();
          renderLoop.run();
        },
        { flush: "sync" },
      );
      watch(
        () => uiStore.mode,
        (newMode) => {
          const retainedSession = useMapSessionStore().snapshot?.mode === newMode;
          if (!retainedSession) syncSessionDataForMode(newMode);
          syncModeVectorFilters();
          if (newMode === "edit" && !retainedSession) {
            void useContributionStore()
              .refresh()
              .catch((error: unknown) => {
                console.error("Contribution refresh failed", error);
              });
          }
        },
        { immediate: true },
      );
      watchOverlayReconciliation(renderLoop.run);
      watchMarkerColors();
      watchPendingProjectSources();
      watchTileLayerState();
      onScopeDispose(watchEditHandles());
      onScopeDispose(watchMapAreaOutline());
      onScopeDispose(watchProjectShapePreview());
      onScopeDispose(installOverlayStyleSwitchHandling());
      target.on("moveend", renderLoop.run);
      onScopeDispose(() => {
        target.off("moveend", renderLoop.run);
      });
      onScopeDispose(
        onStyleSwitch((phase) => {
          if (phase === "after") {
            renderMapSessionPendingSources();
            syncTileLayerState();
            renderLoop.run();
          }
        }),
      );
      onScopeDispose(initVectorTileSync(target));
      onScopeDispose(startBasemap(target));
    });
  } catch (error) {
    scope.stop();
    throw error;
  }
  return () => {
    scope.stop();
  };
}
