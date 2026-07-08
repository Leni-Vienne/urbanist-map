// Viewport-based content manager
// View mode: vectorTileSync + cluster source handle rendering (no data loading)
// Edit: session-scoped fetch (own pending + own open-CR + own projects), once per entry
// Moderation: country-scoped fetch, once per country selection
// moveend re-runs the render loop off the in-memory list; it performs NO network fetch.
// All state is module-scoped: every consumer drives the same single map viewport.
import { watch } from "vue";
import { map } from "@/services/core/map";
import { useOverlayStore } from "@/stores/overlayStore";
import { useMapStore } from "@/stores/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { debounce } from "@/utils/debounce";
import { isOverlayVisible } from "@/services/overlay/visibility";
import { runViewportRenderLoop, initializeRenderTriggers } from "@/services/map/viewportRenderLoop";
import {
  clearAllOverlays,
  clearOverlayImagesOnly,
  clearOverlayRenderState,
} from "@/services/overlay/lifecycle";
import * as registry from "@/services/overlay/mapLayers";
import { upsertOverlayFromWire } from "@/services/overlay/sync";
import { overlayWireToData } from "@/utils/typeFactories";
import { loadOrNull } from "@/services/core/errorHandling";
import { trpc, type RouterOutput } from "@/client";
import { mergeProjectPointsForMode } from "@/services/map/tiles/pendingSources";
import type { OverlayData } from "@/types/index";

type EditSessionProjects = RouterOutput["viewport"]["getEditSessionData"]["projects"];
type ModerationProjects = RouterOutput["viewport"]["getModerationMapData"]["projects"];

function hydrateOverlayStoreObjects(overlaysData: OverlayData[]): void {
  for (const overlayData of overlaysData) {
    upsertOverlayFromWire(overlayData);
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

function clearMapSessionLists(): void {
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

  const rows = await loadOrNull(async () => trpc.viewport.getEditSessionData.query(), {
    errorMessage: "Failed to fetch edit session data",
  });

  // Keep the previous lists on transient failure rather than dropping the session set.
  if (!rows) return;

  editSessionOverlays = rows.overlays.map(overlayWireToData);
  editSessionProjects = rows.projects;
  hydrateOverlayStoreObjects(editSessionOverlays);
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
  const rows = await loadOrNull(async () =>
    trpc.viewport.getModerationMapData.query({
      countryCode: mapStore.selectedCountryCode ?? undefined,
    }),
  );

  if (!rows) return;

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

function renderFullOverlays(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();

  overlayStore.setViewModeOverlays(overlaysData);
  hydrateOverlayStoreObjects(overlaysData);

  // The reconciler owns image + marker existence for the viewModeOverlays it just received.
  runViewportRenderLoop();
}

/**
 * Render overlay markers only (low-to-mid zoom in edit/moderation).
 */
function renderMarkersOnly(overlaysData: OverlayData[]): void {
  const overlayStore = useOverlayStore();
  clearOverlayImagesOnly();

  overlayStore.setViewModeOverlays(overlaysData);
  hydrateOverlayStoreObjects(overlaysData);

  // The reconciler owns marker existence for the viewModeOverlays it just received.
  runViewportRenderLoop();
}

/**
 * Below the load threshold: drop render state but keep the overlay store, so an
 * in-progress edit session survives zooming out. Edit mode keeps its markers on the map.
 * The pending cluster source is left intact so its dots still cluster the in-memory set from afar.
 */
function handleLowZoomViewport(): void {
  const mapStore = useMapStore();
  if (mapStore.mode === "edit") clearOverlayImagesOnly();
  else clearOverlayRenderState();
}

/**
 * Re-render the current viewport off the in-memory session/country list. Runs on moveend and after
 * a fetch. Performs no network request; the render loop and reconciler own per-viewport rendering.
 */
export function refreshViewport(): void {
  const mapStore = useMapStore();
  const zoom = map.value.getZoom();
  const loadThreshold = getEffectiveThreshold(MAP_CONFIG.VIEWPORT_LOAD_THRESHOLD);
  const overlayThreshold = getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);

  if (zoom < loadThreshold) {
    handleLowZoomViewport();
    return;
  }

  // View mode: vectorTileSync and the cluster source handle rendering; the loop prunes local
  // overlays and renders shapes.
  if (mapStore.mode === "view") {
    runViewportRenderLoop();
    return;
  }

  // Edit/moderation: render from the static session/country list. No fetch, no point re-merge.
  const list = mapStore.mode === "edit" ? editSessionOverlays : moderationOverlays;
  if (zoom >= overlayThreshold) {
    renderFullOverlays(list);
  } else {
    renderMarkersOnly(list);
  }
}

// ── Event listeners ─────────────────────────────────────────────────────

const debouncedRefreshViewport = debounce(refreshViewport, 100);

// MapLibre's off() needs the exact handler reference to remove a listener.
let viewportMoveEndHandler: (() => void) | null = null;

// Zooming is a camera move in MapLibre, so moveend also fires after zooms.
export function setupEventListeners() {
  viewportMoveEndHandler = () => {
    debouncedRefreshViewport();
  };
  map.value.on("moveend", viewportMoveEndHandler);
}

export function cleanupEventListeners() {
  if (viewportMoveEndHandler) {
    map.value.off("moveend", viewportMoveEndHandler);
    viewportMoveEndHandler = null;
  }
}

// MapView can remount; the watchers tie to global state so once is enough.
let modeWatcherInitialized = false;

export function setupModeWatcher() {
  initializeRenderTriggers();

  if (modeWatcherInitialized) return;
  modeWatcherInitialized = true;

  const mapStore = useMapStore();
  watch(
    () => mapStore.mode,
    async (newMode, oldMode) => {
      // Switching TO view mode: drop rendered layer refs (tile rendering takes over) but keep
      // overlay store data so in-progress edits survive the round-trip back to edit mode.
      if (newMode === "view") {
        clearOverlayRenderState();
        clearMapSessionLists();
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
    },
  );

  // Moderation follows the selected country: refetch its pending set when the code changes.
  watch(
    () => mapStore.selectedCountryCode,
    () => {
      if (mapStore.mode === "moderation") void refreshModerationMapData();
    },
  );
}
