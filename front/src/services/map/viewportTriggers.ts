// Viewport-based content manager
// View mode: the vector tile sync and cluster source handle rendering (no data loading)
// Edit: renders the session snapshot published by the user-contribution loader
// Moderation: no independent data loading; it renders the published session snapshot
// moveend re-runs the render loop off the in-memory session snapshot; it performs NO network fetch, and no
// zoom decisions: the reconciler owns what exists on the map at the current zoom.
// The map runtime owns the camera listener; session snapshots survive map remounts.
import { useMapSessionStore } from "@/stores/mapSessionStore";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { debounce } from "@/utils/debounce";
import { isOverlayVisible } from "@/services/overlay/visibility";
import * as registry from "@/services/overlay/mapLayers";
import { renderMapSessionPendingSources } from "@/services/map/tiles/pendingSources";
import type { AppMode } from "@shared/types";

/**
 * Re-render the viewport whenever `target`'s camera settles. Zooming is a camera move in MapLibre,
 * so moveend also fires after zooms. Returns the disposer.
 */
export function setupEventListeners(target: MaplibreMap, renderOverlays: () => void): () => void {
  const debouncedRefreshViewport = debounce(renderOverlays, 100);
  target.on("moveend", debouncedRefreshViewport);

  return function stopViewportMoveListener(): void {
    target.off("moveend", debouncedRefreshViewport);
  };
}

/**
 * Drop the mode-session sets along with the layers and pending sources rendered from them, leaving
 * the map to its tiles. Overlay store data is kept, so in-progress edits survive a round trip back
 * to edit mode. Safe to call with no map mounted.
 */
function resetMapSessionState(): void {
  useMapSessionStore().clearAllState();
  registry.clearAll();
  renderMapSessionPendingSources();
}

export function syncSessionDataForMode(newMode: AppMode): void {
  // Switching TO view mode: tile rendering takes over.
  if (newMode === "view") {
    resetMapSessionState();
    return;
  }

  // The snapshot is mode-scoped; the loader for the mode being entered publishes its own.
  useMapSessionStore().clearAllState();
  renderMapSessionPendingSources();

  // Switching TO edit or moderation: hide overlays not visible in the new mode
  const overlayStore = useOverlayStore();
  const currentUserId = useAuthStore().user?.id;
  for (const [id, overlay] of Object.entries(overlayStore.liveOverlays)) {
    if (!isOverlayVisible(overlay, newMode, currentUserId)) {
      registry.clearEntry(id);
    }
  }
}
