// Viewport-based content manager
// View mode: the vector tile sync and cluster source handle rendering (no data loading)
// Edit: session-scoped fetch (own pending + own open-CR + own projects), once per entry
// Moderation: country-scoped fetch, once per country selection
// moveend re-runs the render loop off the in-memory list; it performs NO network fetch, and no
// zoom decisions: the reconciler owns what exists on the map at the current zoom.
// All state is module-scoped: every consumer drives the same single map viewport.
import { watch } from "vue";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useOverlayStore } from "@/stores/overlayStore";
import { useMapStore } from "@/stores/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { debounce } from "@/utils/debounce";
import { isOverlayVisible } from "@/services/overlay/visibility";
import { runViewportRenderLoop } from "@/services/map/viewportRenderLoop";
import {
  clearAllOverlays,
  clearOverlayImagesOnly,
  clearOverlayRenderState,
} from "@/services/overlay/teardown";
import * as registry from "@/services/overlay/mapLayers";
import { clearOverlayChangeRequestState, upsertOverlayFromWire } from "@/services/overlay/sync";
import { overlayWireToData } from "@/utils/typeFactories";
import { loadOrNull } from "@/services/core/errorHandling";
import { trpc, type RouterOutput } from "@/client";
import {
  mergeProjectPointsForMode,
  watchPendingProjectSources,
} from "@/services/map/tiles/pendingSources";
import { onModeTransition } from "@/services/map/modeTransition";
import type { OverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";

type EditSessionProjects = RouterOutput["viewport"]["getEditSessionData"]["projects"];
type ModerationProjects = RouterOutput["viewport"]["getModerationMapData"]["projects"];

function hydrateOverlayStoreObjects(overlaysData: OverlayData[]): void {
  for (const overlayData of overlaysData) {
    upsertOverlayFromWire(overlayData);
  }
}

// The edit-session set contains every overlay the user has an open change request on, so an
// overlay carrying change-request state but absent from it has none anymore (it was resolved).
function clearResolvedChangeRequestState(sessionOverlays: OverlayData[]): void {
  const sessionIds = new Set(sessionOverlays.map((overlay) => overlay.id));
  const overlayStore = useOverlayStore();

  for (const overlay of Object.values(overlayStore.liveOverlays)) {
    if (overlay.hasPendingChanges === true && !sessionIds.has(overlay.id)) {
      clearOverlayChangeRequestState(overlay);
    }
  }
}

// Full static pending set for the current edit session / moderation country selection. Fetched
// once on entry (and re-fetched on explicit mutation events), then rendered off these lists on
// every moveend with no network call. The existence reconciler owns which overlays get an
// image/marker for the current viewport.
let editSessionOverlays: OverlayData[] = [];
let editSessionProjects: EditSessionProjects = [];
let moderationOverlays: OverlayData[] = [];
let moderationProjects: ModerationProjects = [];

// Mode transitions are not serialized and the country selection can change mid-flight, so a fetch
// may resolve after the state it was issued for is gone. Every fetch takes a token and applies its
// rows only while that token is still current; starting a fetch or clearing the lists invalidates
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
export function clearMapSessionLists(): void {
  sessionFetchToken += 1;
  editSessionOverlays = [];
  editSessionProjects = [];
  moderationOverlays = [];
  moderationProjects = [];
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
    editSessionOverlays = [];
    editSessionProjects = [];
    return;
  }

  const token = beginSessionFetch();
  const rows = await loadOrNull(async () => trpc.viewport.getEditSessionData.query(), {
    errorMessage: "Failed to fetch edit session data",
  });

  // Keep the previous lists on transient failure rather than dropping the session set.
  if (!rows) return;
  if (token !== sessionFetchToken) return;

  editSessionOverlays = rows.overlays.map(overlayWireToData);
  editSessionProjects = rows.projects;
  hydrateOverlayStoreObjects(editSessionOverlays);
  clearResolvedChangeRequestState(editSessionOverlays);
  mergeProjectPointsForMode(editSessionOverlays, editSessionProjects, "edit");
  refreshViewport();
}

/**
 * Fetch the selected country's moderation pending set (pending overlays + approved-with-open-CR
 * overlays + projects needing moderation) and render it. Cleared outside moderation mode or when
 * no country is selected. Called on moderation entry, country switch, and after approve/reject.
 */
async function refreshModerationMapData(): Promise<void> {
  const mapStore = useMapStore();

  if (mapStore.mode !== "moderation" || !mapStore.selectedCountryCode) {
    moderationOverlays = [];
    moderationProjects = [];
    return;
  }

  // No errorMessage: a country-permission rejection is swallowed quietly (logged, not toasted).
  const token = beginSessionFetch();
  const rows = await loadOrNull(async () =>
    trpc.viewport.getModerationMapData.query({
      countryCode: mapStore.selectedCountryCode ?? undefined,
    }),
  );

  if (!rows) return;
  if (token !== sessionFetchToken) return;

  moderationOverlays = rows.overlays.map(overlayWireToData);
  moderationProjects = rows.projects;
  hydrateOverlayStoreObjects(moderationOverlays);
  mergeProjectPointsForMode(moderationOverlays, moderationProjects, "moderation");
  refreshViewport();
}

/**
 * Refetch the map session set for the active mode. Called by mutation events (CR submit/withdraw,
 * approve/reject) so the map reflects the new server state.
 */
export async function refreshMapSessionData(): Promise<void> {
  const mode = useMapStore().mode;
  if (mode === "edit") await refreshEditSessionData();
  else if (mode === "moderation") await refreshModerationMapData();
}

/**
 * Re-render the current viewport off the in-memory session/country list. Runs on moveend and after
 * a fetch. Performs no network request, and no point re-merge; the render loop and its reconciler
 * own which overlays hold an image/marker at the current viewport and zoom.
 *
 * View mode has no session list: approved overlays reach the reconciler through the vector tile
 * sync, so it only hands the loop the pending set of edit/moderation.
 */
export function refreshViewport(): void {
  const mapStore = useMapStore();

  if (mapStore.mode !== "view") {
    const list = mapStore.mode === "edit" ? editSessionOverlays : moderationOverlays;
    useOverlayStore().setRenderLoopOverlays(list);
  }

  runViewportRenderLoop();
}

// ── Event listeners ─────────────────────────────────────────────────────

const debouncedRefreshViewport = debounce(refreshViewport, 100);

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

async function syncSessionDataForMode(newMode: AppMode, oldMode: AppMode): Promise<void> {
  // The lists are mode-scoped; the mode being entered refetches its own.
  clearMapSessionLists();

  // Switching TO view mode: drop rendered layer refs (tile rendering takes over) but keep
  // overlay store data so in-progress edits survive the round-trip back to edit mode.
  if (newMode === "view") {
    clearOverlayRenderState();
    mergeProjectPointsForMode([], [], "view");
    runViewportRenderLoop();
    return;
  }

  // Switching TO edit or moderation: hide overlays not visible in the new mode
  const overlayStore = useOverlayStore();
  const currentUserId = useAuthStore().user?.id;
  for (const [id, overlay] of Object.entries(overlayStore.liveOverlays)) {
    if (!isOverlayVisible(overlay, newMode, currentUserId)) {
      registry.clearEntry(id);
    }
  }

  // View mode is tiles-only, so clear before loading the session data.
  if (oldMode === "view") {
    if (newMode === "edit") clearOverlayImagesOnly();
    else clearAllOverlays();
  }

  if (newMode === "edit") await refreshEditSessionData();
  else await refreshModerationMapData();

  runViewportRenderLoop();
}

export function watchViewportModeData(): () => void {
  const mapStore = useMapStore();

  const unregisterModeTransition = onModeTransition("viewportSessionData", syncSessionDataForMode);
  const stopPendingProjectWatch = watchPendingProjectSources();

  // Moderation follows the selected country: refetch its pending set when the code changes.
  const stopCountryWatch = watch(
    () => mapStore.selectedCountryCode,
    () => {
      if (mapStore.mode === "moderation") void refreshModerationMapData();
    },
  );
  return function stopViewportModeDataWatchers(): void {
    stopCountryWatch();
    stopPendingProjectWatch();
    unregisterModeTransition();
  };
}
