// Viewport-based content manager
// View mode: the vector tile sync and cluster source handle rendering (no data loading)
// Edit: session-scoped fetch (own pending + own open-CR + own projects), once per entry
// Moderation: no independent data loading; it renders the published session snapshot
// moveend re-runs the render loop off the in-memory session snapshot; it performs NO network fetch, and no
// zoom decisions: the reconciler owns what exists on the map at the current zoom.
// All state is module-scoped: every consumer drives the same single map viewport.
import { watch } from "vue";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useMapStore } from "@/stores/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { debounce } from "@/utils/debounce";
import { isOverlayVisible } from "@/services/overlay/visibility";
import { runViewportRenderLoop } from "@/services/map/viewportRenderLoop";
import { clearAllOverlays, clearOverlayRenderState } from "@/services/overlay/teardown";
import * as registry from "@/services/overlay/mapLayers";
import { clearOverlayChangeRequestState, upsertOverlayFromWire } from "@/services/overlay/sync";
import { projectFromWire, overlayWireToData, type ProjectWire } from "@/utils/typeFactories";
import { loadOrNull } from "@/services/core/errorHandling";
import { trpc } from "@/client";
import {
  renderMapSessionPendingSources,
  watchPendingProjectSources,
} from "@/services/map/tiles/pendingSources";
import { clearMapSessionSnapshot, replaceMapSessionSnapshot } from "@/services/map/mapSessionState";
import { onModeTransition } from "@/services/map/modeTransition";
import type { OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";

function cacheMapSessionOverlays(overlaysData: OverlayData[]): string[] {
  return overlaysData.map((overlayData) => upsertOverlayFromWire(overlayData).id);
}

function cacheMapSessionProjects(projects: ProjectWire[]): string[] {
  const projectStore = useProjectStore();
  const projectIds: string[] = [];
  for (const project of projects) {
    const stored = projectStore.adoptBackendProjectSummary(projectFromWire(project));
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
      clearOverlayChangeRequestState(overlay);
    }
  }
}

// Cache a fetched session set into the stores, then make it the mode's snapshot and render it.
export function applyMapSessionRows(
  mode: "edit" | "moderation",
  projects: ProjectWire[],
  overlays: OverlayData[],
): void {
  const projectIds = cacheMapSessionProjects(projects);
  const overlayIds = cacheMapSessionOverlays(overlays);
  if (mode === "edit") clearResolvedChangeRequestState(overlayIds);
  replaceMapSessionSnapshot({ mode, overlayIds, projectIds });
  renderMapSessionPendingSources();
  runViewportRenderLoop();
}

// Mode transitions are not serialized and the country selection can change mid-flight, so a fetch
// may resolve after the state it was issued for is gone. Every fetch takes a token and applies its
// rows only while that token is still current; starting a fetch or clearing the snapshot invalidates
// whatever is in flight.
let sessionFetchToken = 0;

function beginSessionFetch(): number {
  sessionFetchToken += 1;
  return sessionFetchToken;
}

/**
 * Drop the mode-session sets and invalidate any fetch in flight for them. The mode being entered,
 * or the next map mount, fetches its own.
 */
export function clearMapSessionData(): void {
  sessionFetchToken += 1;
  clearMapSessionSnapshot();
}

/**
 * Fetch the caller's full edit-session pending set (own pending overlays + own open change-request
 * overlays + own non-approved projects) and render it. Cleared outside edit mode. Called on edit
 * entry and after a CR submit/withdraw.
 */
async function refreshEditSessionData(): Promise<void> {
  const authStore = useAuthStore();
  const mapStore = useMapStore();

  if (!authStore.user || mapStore.mode !== "edit") {
    clearMapSessionSnapshot("edit");
    return;
  }

  const token = beginSessionFetch();
  const rows = await loadOrNull(async () => trpc.viewport.getEditSessionData.query(), {
    errorMessage: "Failed to fetch edit session data",
  });

  // Keep the previous snapshot on transient failure rather than dropping the session set.
  if (!rows) return;
  if (token !== sessionFetchToken) return;

  applyMapSessionRows("edit", rows.projects, rows.overlays.map(overlayWireToData));
}

/** Refetch the edit-session set when edit mode is active. */
export async function refreshMapSessionData(): Promise<void> {
  if (useMapStore().mode === "edit") await refreshEditSessionData();
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

async function syncSessionDataForMode(newMode: AppMode, oldMode: AppMode): Promise<void> {
  // Switching TO view mode: tile rendering takes over.
  if (newMode === "view") {
    resetMapSessionState();
    return;
  }

  // The snapshot is mode-scoped; the mode being entered refetches its own.
  clearMapSessionData();

  // Switching TO edit or moderation: hide overlays not visible in the new mode
  const overlayStore = useOverlayStore();
  const currentUserId = useAuthStore().user?.id;
  for (const [id, overlay] of Object.entries(overlayStore.liveOverlays)) {
    if (!isOverlayVisible(overlay, newMode, currentUserId)) {
      registry.clearEntry(id);
    }
  }

  // Moderation must not inherit view-mode overlay data.
  if (oldMode === "view" && newMode === "moderation") clearAllOverlays();

  if (newMode === "edit") await refreshEditSessionData();

  runViewportRenderLoop();
}

export function watchViewportModeData(): () => void {
  const mapStore = useMapStore();

  const unregisterModeTransition = onModeTransition("viewportSessionData", syncSessionDataForMode);
  const stopPendingProjectWatch = watchPendingProjectSources();

  // Clear the old moderation snapshot when its country scope changes.
  const stopCountryWatch = watch(
    () => mapStore.selectedCountryCode,
    () => {
      if (mapStore.mode !== "moderation") return;
      clearMapSessionData();
      renderMapSessionPendingSources();
      runViewportRenderLoop();
    },
  );
  return function stopViewportModeDataWatchers(): void {
    stopCountryWatch();
    stopPendingProjectWatch();
    unregisterModeTransition();
  };
}
