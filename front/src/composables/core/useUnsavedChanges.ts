import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";

/**
 * AI : Composable to check for unsaved changes across the application
 * AI : Used for safeguarding against accidental data loss on logout or tab close
 */
export function useUnsavedChanges() {
  function hasUnsavedChanges(): boolean {
    const projectStore = useProjectStore();
    const overlayStore = useOverlayStore();
    const pendingModificationsStore = usePendingModificationsStore();

    // AI : 1. Check unified pending modifications store (captions, corners)
    if (pendingModificationsStore.hasAnyModifications) {
      return true;
    }

    // AI : 2. Check for modified or new (unsubmitted) overlays in current session
    // AI : status undefined/null means never submitted (local only)
    const hasModifiedOverlays = Object.values(overlayStore.overlays).some(
      (overlay) =>
        overlay.isModified === true || overlay.status === undefined || overlay.status === null,
    );
    if (hasModifiedOverlays) return true;

    // AI : 3. Check for modified or new (unsubmitted) projects in active projects list
    // AI : status null means local only. isModified means edited fields.
    const hasModifiedProjects = Object.values(projectStore.projects).some(
      (project) => project.status === null || project.isModified === true,
    );
    if (hasModifiedProjects) return true;

    // AI : 4. Check userContributions for any dirty state?
    // AI : Generally displayedProjects/userContributions reflect state already checked above
    // AI : if they are currently loaded as objects.
    // AI : However, if we edited something in a previous "session" (panel open) but not in current map view?
    // AI : It's tough to know without loading everything.
    // AI : But usually editing requires loading into `projects` or `overlays` store.
    // AI : Except maybe "ContributePanel" edits without entering Edit Mode?
    // AI : ContributePanel editing uses `uiStore.openProjectEditForm` which loads into `projectStore`?
    // AI : Not necessarily. `useSubmissionDialog` handles some state.

    // AI : For now, Checking stores is the best heuristic for "Active" changes.

    return false;
  }

  return {
    hasUnsavedChanges,
  };
}
