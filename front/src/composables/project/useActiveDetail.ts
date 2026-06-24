import { computed, type ComputedRef } from "vue";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";

interface ActiveDetail {
  // Whether any detail surface is open. The detail slide-over is one surface that shows either an
  // overlay or a standalone project, but its open state lives in two store flags; this is the single
  // definition that unions them, so logic layered on top (mode gating, the mobile drawer) can't
  // handle one flag and miss the other.
  visible: ComputedRef<boolean>;
  // The project behind whichever detail is open: an open overlay detail's parent project first, then
  // the standalone project detail. Null when nothing is open.
  projectId: ComputedRef<string | null>;
}

export function useActiveDetail(): ActiveDetail {
  const overlayStore = useOverlayStore();
  const uiStore = useUiStore();

  const visible = computed(
    () => overlayStore.overlayDetailVisible || uiStore.projectDetail.visible,
  );

  const projectId = computed(() => {
    const overlayId = overlayStore.overlayDetailId;
    if (overlayStore.overlayDetailVisible && overlayId) {
      const parentProjectId = overlayStore.overlays[overlayId]?.projectId;
      if (parentProjectId) return parentProjectId;
    }
    if (uiStore.projectDetail.visible) return uiStore.projectDetail.projectId;
    return null;
  });

  return { visible, projectId };
}
