import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";

/**
 * Composable to check for unsaved changes across the application
 * Used for safeguarding against accidental data loss on logout or tab close
 */
export function useUnsavedChanges() {
  function hasUnsavedChanges(): boolean {
    const projectStore = useProjectStore();
    const overlayStore = useOverlayStore();
    const pendingModificationsStore = usePendingModificationsStore();

    // 1. Check unified pending modifications store (captions, corners)
    if (pendingModificationsStore.hasAnyModifications) {
      return true;
    }

    // 2. Check for modified or new (unsubmitted) overlays in current session
    // status undefined/null means never submitted (local only)
    const hasModifiedOverlays = Object.values(overlayStore.overlays).some(
      (overlay) => overlay.isModified === true || overlay.status === null,
    );
    if (hasModifiedOverlays) return true;

    // 3. Check for modified or new (unsubmitted) projects in active projects list
    // status null means local only. isModified means edited fields.
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
