import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";

/**
 * Composable to check for unsaved changes across the application.
 * Used to safeguard against accidental data loss on logout or tab close.
 */
export function useUnsavedChanges() {
  function hasUnsavedChanges(): boolean {
    const projectStore = useProjectStore();
    const overlayStore = useOverlayStore();
    const pendingModificationsStore = usePendingModificationsStore();

    if (pendingModificationsStore.hasAnyModifications) {
      return true;
    }

    // status null means never submitted (local only)
    const hasModifiedOverlays = Object.values(overlayStore.overlays).some(
      (overlay) => overlay.isModified === true || overlay.status === null,
    );
    if (hasModifiedOverlays) return true;

    // status null means local only; isModified means edited fields
    const hasModifiedProjects = Object.values(projectStore.projects).some(
      (project) => project.status === null || project.isModified === true,
    );
    if (hasModifiedProjects) return true;

    return false;
  }

  return {
    hasUnsavedChanges,
  };
}
