import { useContributionStore } from "@/stores/contributionStore";
import { useMapSessionStore } from "@/stores/mapSessionStore";
import { watch } from "vue";
import type { Map as MaplibreMap } from "maplibre-gl";
import { getMapOrNull } from "@/services/core/map";
import {
  watchEditHandles,
  syncEditHandlesForMode,
  syncEditHandlesForCurrentState,
} from "@/services/overlay/editing";
import { watchMarkerColors } from "@/services/overlay/markers";
import { watchOverlayReconciliation } from "@/services/map/viewportRenderLoop";
import { syncSessionDataForMode } from "@/services/map/viewportTriggers";
import {
  renderMapSessionPendingSources,
  watchPendingProjectSources,
} from "@/services/map/tiles/pendingSources";
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
  const retainedSession = useMapSessionStore().snapshot?.mode === newMode;
  if (!retainedSession) {
    syncSessionDataForMode(newMode);
    if (newMode === "edit") await useContributionStore().refresh();
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
 * Install the state watchers owned by one MapView mount.
 * MapLibre layers may not exist when these watchers first run, so callbacks must guard layer access.
 */
export function startMapStateCoordinator(renderOverlays: () => void): () => void {
  const stops = [
    watchModeTransitions(),
    watchEditHandles(),
    watchOverlayReconciliation(renderOverlays),
    watchMarkerColors(),
    watchPendingProjectSources(),
    watchTileLayerState(),
    watchMapAreaOutline(),
    watchProjectShapePreview(),
  ];

  let stopped = false;
  return function stopMapStateCoordinator(): void {
    if (stopped) return;
    stopped = true;
    for (const stop of stops.toReversed()) stop();
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
