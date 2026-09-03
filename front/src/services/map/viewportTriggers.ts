// Viewport-based content manager
// View mode: the vector tile sync and cluster source handle rendering (no data loading)
// Edit: renders the session snapshot published by the user-contribution loader
// Moderation: no independent data loading; it renders the published session snapshot
// moveend re-runs the render loop off the in-memory session snapshot; it performs NO network fetch, and no
// zoom decisions: the reconciler owns what exists on the map at the current zoom.
// All state is module-scoped: every consumer drives the same single map viewport.
import { watch } from "vue";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useModerationStore } from "@/stores/moderationStore";
import { debounce } from "@/utils/debounce";
import { isOverlayVisible } from "@/services/overlay/visibility";
import { runViewportRenderLoop } from "@/services/map/viewportRenderLoop";
import { clearOverlayRenderState } from "@/services/overlay/teardown";
import * as registry from "@/services/overlay/mapLayers";
import { projectFromWire, type ProjectWire } from "@/utils/typeFactories";
import {
  renderMapSessionPendingSources,
  watchPendingProjectSources,
} from "@/services/map/tiles/pendingSources";
import { clearMapSessionSnapshot, replaceMapSessionSnapshot } from "@/services/map/mapSessionState";
import type { BackendOverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";

function cacheMapSessionOverlays(
  overlaysData: BackendOverlayData[],
  replaceOverlayIds?: ReadonlySet<string>,
): string[] {
  const overlayStore = useOverlayStore();
  return overlaysData.map(
    (overlayData) =>
      overlayStore.ingestBackendOverlay(overlayData, !replaceOverlayIds?.has(overlayData.id)).id,
  );
}

function cacheMapSessionProjects(projects: ProjectWire[]): string[] {
  const projectStore = useProjectStore();
  const projectIds: string[] = [];
  for (const project of projects) {
    const stored = projectStore.upsertProjectSummary(projectFromWire(project));
    projectIds.push(stored.id);
  }
  return projectIds;
}

// The edit-session set contains every overlay the user has an open change request on, so an
// overlay carrying change-request state but absent from it has none anymore (it was resolved).
function clearResolvedChangeRequestState(sessionOverlayIds: string[]): void {
  const sessionIds = new Set(sessionOverlayIds);
  const overlayStore = useOverlayStore();

  for (const overlay of Object.values(overlayStore.liveOverlays)) {
    if (overlay.hasPendingChanges === true && !sessionIds.has(overlay.id)) {
      overlayStore.clearPendingChangeRequest(overlay.id);
    }
  }
}

// Cache a fetched session set into the stores, then make it the mode's snapshot and render it.
export function applyMapSessionRows(
  mode: "edit" | "moderation",
  projects: ProjectWire[],
  overlays: BackendOverlayData[],
  replaceOverlayIds?: ReadonlySet<string>,
): string[] {
  const projectIds = cacheMapSessionProjects(projects);
  const overlayIds = cacheMapSessionOverlays(overlays, replaceOverlayIds);
  if (mode === "edit") clearResolvedChangeRequestState(overlayIds);
  replaceMapSessionSnapshot({ mode, overlayIds, projectIds });
  renderMapSessionPendingSources();
  runViewportRenderLoop();
  return projectIds;
}

/**
 * Drop the active mode-session set. Each loader guards its own request before publishing a new one.
 */
export function clearMapSessionData(): void {
  clearMapSessionSnapshot();
}

// ── Event listeners ─────────────────────────────────────────────────────

const debouncedRefreshViewport = debounce(runViewportRenderLoop, 100);

/**
 * Re-render the viewport whenever `target`'s camera settles. Zooming is a camera move in MapLibre,
 * so moveend also fires after zooms. Returns the disposer.
 */
export function setupEventListeners(target: MaplibreMap): () => void {
  function onMoveEnd(): void {
    debouncedRefreshViewport();
  }
  target.on("moveend", onMoveEnd);

  return function stopViewportMoveListener(): void {
    target.off("moveend", onMoveEnd);
  };
}

/**
 * Drop the mode-session sets along with the layers and pending sources rendered from them, leaving
 * the map to its tiles. Overlay store data is kept, so in-progress edits survive a round trip back
 * to edit mode. Safe to call with no map mounted.
 */
export function resetMapSessionState(): void {
  clearMapSessionData();
  clearOverlayRenderState();
  renderMapSessionPendingSources();
  runViewportRenderLoop();
}

export function syncSessionDataForMode(newMode: AppMode): void {
  // Switching TO view mode: tile rendering takes over.
  if (newMode === "view") {
    resetMapSessionState();
    return;
  }

  // The snapshot is mode-scoped; the loader for the mode being entered publishes its own.
  clearMapSessionData();

  // Switching TO edit or moderation: hide overlays not visible in the new mode
  const overlayStore = useOverlayStore();
  const currentUserId = useAuthStore().user?.id;
  for (const [id, overlay] of Object.entries(overlayStore.liveOverlays)) {
    if (!isOverlayVisible(overlay, newMode, currentUserId)) {
      registry.clearEntry(id);
    }
  }

  runViewportRenderLoop();
}

export function watchViewportModeData(): () => void {
  const uiStore = useUiStore();
  const moderationStore = useModerationStore();

  const stopPendingProjectWatch = watchPendingProjectSources();

  // Invalidate all country-scoped moderation state synchronously.
  const stopCountryWatch = watch(
    () => moderationStore.selectedCountryCode,
    () => {
      moderationStore.invalidateModerationData();
      if (uiStore.mode === "moderation") {
        clearMapSessionData();
        renderMapSessionPendingSources();
        runViewportRenderLoop();
      }
    },
    { flush: "sync" },
  );
  return function stopViewportModeDataWatchers(): void {
    stopCountryWatch();
    stopPendingProjectWatch();
  };
}
