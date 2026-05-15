import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { isOverlayUnsaved, isProjectUnsaved } from "@/utils/unsavedState";

/**
 * Composable to check for unsaved changes across the application.
 * Used to safeguard against accidental data loss on logout or tab close.
 */
export function useUnsavedChanges() {
  function hasUnsavedChanges(): boolean {
    const projectStore = useProjectStore();
    const overlayStore = useOverlayStore();

    if (Object.values(overlayStore.overlays).some(isOverlayUnsaved)) return true;
    if (Object.values(projectStore.projects).some(isProjectUnsaved)) return true;
    return false;
  }

  return {
    hasUnsavedChanges,
  };
}
