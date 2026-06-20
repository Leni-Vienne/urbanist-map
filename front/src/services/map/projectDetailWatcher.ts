import { watch } from "vue";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { unhighlightProjectShapes } from "@/services/map/shapeLayerRegistry";
import { selectOverlay } from "@/services/overlay/selection";
import { setExternalHover } from "@/services/map/vectorHoverState";
import { requestScrollTo } from "@/services/layout/accordionState";
import {
  getStandaloneProjectMarkerByProjectId,
  updateStandaloneProjectMarkerOpacities,
} from "@/services/map/standaloneProjectMarkers";

let isWatcherInitialized = false;

/**
 * Drives all detail-state-driven side effects (marker opacity, vector hover highlight,
 * accordion scroll, overlay detail hide, deselect) so click handlers only need to toggle
 * the detail state. Call once at app boot after Pinia is installed.
 */
export function initializeDetailWatcher() {
  if (isWatcherInitialized) return;
  isWatcherInitialized = true;

  watch(
    () => {
      const uiStore = useUiStore();
      return uiStore.projectDetail.visible ? uiStore.projectDetail.projectId : null;
    },
    (newProjectId, oldProjectId) => {
      if (newProjectId === oldProjectId) return;

      const overlayStore = useOverlayStore();
      const mapStore = useMapStore();

      if (oldProjectId && oldProjectId !== newProjectId) {
        unhighlightProjectShapes(oldProjectId);
      }

      if (!newProjectId) {
        updateStandaloneProjectMarkerOpacities(null);
        setExternalHover(null);
        return;
      }

      const marker = getStandaloneProjectMarkerByProjectId(newProjectId) ?? null;
      updateStandaloneProjectMarkerOpacities(marker);

      // Pin the vector tile highlight in view mode (overlay-only projects only render via tiles).
      if (mapStore.mode === "view") {
        setExternalHover(newProjectId);
      }

      requestScrollTo("project", newProjectId);

      if (overlayStore.overlayDetailVisible) overlayStore.closeOverlayDetail();
      if (overlayStore.idSelectedOverlay) selectOverlay(null);
    },
  );
}
