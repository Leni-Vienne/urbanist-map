// Single source of truth for "does this entity have local state not yet on the server?".
// Used by the beforeunload guard, toolbar/popup save buttons, and the contributions sidebar.

import type { OverlayObject, Project } from "@/types/index";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";

type OverlayLike = Pick<OverlayObject, "id" | "status" | "isModified">;
type ProjectLike = Pick<Project, "id" | "status" | "isModified">;

export function isOverlayUnsaved(overlay: OverlayLike): boolean {
  if (overlay.status === null) return true;
  if (overlay.isModified === true) return true;
  return usePendingModificationsStore().hasPendingModifications(overlay.id);
}

export function isProjectUnsaved(project: ProjectLike): boolean {
  if (project.status === null) return true;
  if (project.isModified === true) return true;
  const overlayStore = useOverlayStore();
  return Object.values(overlayStore.liveOverlays).some(
    (o) => o.projectId === project.id && isOverlayUnsaved(o),
  );
}

export function hasUnsavedChanges(): boolean {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();

  if (Object.values(overlayStore.liveOverlays).some(isOverlayUnsaved)) return true;
  if (Object.values(projectStore.projects).some(isProjectUnsaved)) return true;
  return false;
}
