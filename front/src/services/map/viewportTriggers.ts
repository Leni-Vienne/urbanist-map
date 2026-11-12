import { useMapSessionStore } from "@/stores/mapSessionStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useAuthStore } from "@/stores/authStore";
import { isOverlayVisible } from "@/services/overlay/visibility";
import * as registry from "@/services/overlay/mapLayers";
import { renderMapSessionPendingSources } from "@/services/map/tiles/pendingSources";
import type { AppMode } from "@shared/types";

// The snapshot is mode-scoped; entering another mode releases its rendered membership.
export function syncSessionDataForMode(newMode: AppMode): void {
  useMapSessionStore().clearAllState();
  renderMapSessionPendingSources();
  if (newMode === "view") {
    registry.clearAll();
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
}
