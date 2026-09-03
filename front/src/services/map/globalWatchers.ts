import { watch } from "vue";
import type { Map as MaplibreMap } from "maplibre-gl";
import { getMapOrNull } from "@/services/core/map";
import {
  installEditHandleSync,
  watchEditHandles,
  syncEditHandlesForMode,
  syncEditHandlesForCurrentState,
} from "@/services/overlay/editing";
import { watchMarkerColors } from "@/services/overlay/markers";
import {
  installViewportRenderLoop,
  stopViewportRenderLoop,
  watchOverlayReconciliation,
} from "@/services/map/viewportRenderLoop";
import { watchViewportModeData, syncSessionDataForMode } from "@/services/map/viewportTriggers";
import { refreshUserContributions } from "@/services/project/userContributions";
import { renderMapSessionPendingSources } from "@/services/map/tiles/pendingSources";
import { getMapSessionSnapshot } from "@/services/map/mapSessionState";
import {
  watchTileLayerState,
  syncTileLayerState,
  syncModeVectorFilters,
} from "@/services/map/tiles/layers";
import { watchMapAreaOutline, syncMapAreaOutline } from "@/services/map/mapAreaOutline";
import {
  syncProjectShapePreview,
  watchProjectShapePreview,
} from "@/services/map/shapes/previewCoordinator";
import { useUiStore } from "@/stores/uiStore";
import type { AppMode } from "@shared/types";

async function applyModeTransition(newMode: AppMode): Promise<void> {
  syncEditHandlesForMode(newMode);
  const retainedSession = getMapSessionSnapshot()?.mode === newMode;
  if (!retainedSession) {
    syncSessionDataForMode(newMode);
    if (newMode === "edit") await refreshUserContributions();
  }
  syncModeVectorFilters();
}

function watchModeTransitions(): () => void {
  const uiStore = useUiStore();
  return watch(
    () => uiStore.mode,
    (newMode) => {
      void applyModeTransition(newMode).catch((error: unknown) =>
        console.error("Mode session sync failed", error),
      );
    },
    { immediate: true },
  );
}

/**
 * Install the watchers and callback registrations owned by one MapView mount.
 * MapLibre layers may not exist when these watchers first run, so callbacks must guard layer access.
 */
export function startMapStateCoordinator(): () => void {
  const unregisterReconcile = installViewportRenderLoop();
  const unregisterEditHandleSync = installEditHandleSync();
  const stops = [
    watchModeTransitions(),
    watchEditHandles(),
    watchOverlayReconciliation(),
    watchMarkerColors(),
    watchViewportModeData(),
    watchTileLayerState(),
    watchMapAreaOutline(),
    watchProjectShapePreview(),
  ];

  let stopped = false;
  return function stopMapStateCoordinator(): void {
    if (stopped) return;
    stopped = true;
    for (const stop of stops.toReversed()) stop();
    unregisterReconcile();
    stopViewportRenderLoop();
    unregisterEditHandleSync();
  };
}

/** Project the retained application state onto a newly-ready map instance. */
export function activateMapStateCoordinator(target: MaplibreMap): void {
  if (getMapOrNull() !== target) return;
  syncEditHandlesForCurrentState();
  renderMapSessionPendingSources();
  syncTileLayerState();
  syncMapAreaOutline();
  syncProjectShapePreview();
}
