import { computed, type ComputedRef } from "vue";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";

/**
 * The id of the project currently selected on the map, resolved from whichever signal carries it:
 * the open standalone project detail, or (when an overlay is selected, which closes the detail) the
 * selected overlay's parent project. Returns null when nothing is selected.
 */
export function useSelectedProjectId(): { selectedProjectId: ComputedRef<string | null> } {
  const uiStore = useUiStore();
  const overlayStore = useOverlayStore();

  const selectedProjectId = computed<string | null>(() => {
    if (uiStore.projectDetail.visible && uiStore.projectDetail.projectId) {
      return uiStore.projectDetail.projectId;
    }
    const overlayId = overlayStore.idSelectedOverlay;
    if (overlayId) {
      return overlayStore.overlays[overlayId]?.projectId ?? null;
    }
    return null;
  });

  return { selectedProjectId };
}
