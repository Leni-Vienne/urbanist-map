import { computed, type ComputedRef } from "vue";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";

// The id of the project behind whichever detail panel is open: the open overlay detail's parent
// project first, then the standalone project detail. Null when no detail is open.
export function useActiveDetailProjectId(): ComputedRef<string | null> {
  const overlayStore = useOverlayStore();
  const uiStore = useUiStore();

  return computed(() => {
    const overlayId = overlayStore.overlayDetailId;
    if (overlayStore.overlayDetailVisible && overlayId) {
      const projectId = overlayStore.overlays[overlayId]?.projectId;
      if (projectId) return projectId;
    }
    if (uiStore.projectDetail.visible) return uiStore.projectDetail.projectId;
    return null;
  });
}
