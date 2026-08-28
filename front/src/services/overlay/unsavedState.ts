// Single source of truth for "does this entity have local state not yet on the server?".
// Used by the beforeunload guard, toolbar/popup save buttons, and the contributions sidebar.

import type { LatLng, OverlayObject, PendingOverlayModification, Project } from "@/types/index";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { hasStagedRender, hasStagedRenders } from "@/services/submission/stagedRenderState";

type OverlayLike = Pick<OverlayObject, "id" | "status">;
type ProjectLike = Pick<Project, "id" | "status">;

// Staged (unsubmitted) corners delta, derived from edit history: history beyond the seed step
// means the user moved/resized the overlay since its last-submitted position.
function getStagedCornersDelta(
  overlay: Pick<OverlayObject, "status" | "history" | "baselineCorners" | "positionState">,
): { current: LatLng[]; original: LatLng[] } | null {
  if (overlay.status === null) return null; // new overlays: position lives only in history
  if (overlay.positionState !== "staged") return null;
  const current = overlay.history.at(-1)?.corners;
  if (!current) return null;
  return { current, original: overlay.baselineCorners ?? [] };
}

// Edit-mode default caption: the proposed caption of an open change request when one exists,
// otherwise the approved baseline. Mirror of getEditModeDefaultCorners.
export function getEditModeDefaultCaption(
  overlay: Pick<OverlayObject, "hasPendingChanges" | "suggestedCaption" | "baselineCaption">,
): string | null {
  if (
    overlay.hasPendingChanges === true &&
    overlay.suggestedCaption !== null &&
    overlay.suggestedCaption !== undefined
  ) {
    return overlay.suggestedCaption;
  }
  return overlay.baselineCaption;
}

// Staged (unsubmitted) caption delta, derived: the live caption differs from the edit-mode default.
function getStagedCaptionDelta(
  overlay: Pick<
    OverlayObject,
    "status" | "caption" | "hasPendingChanges" | "suggestedCaption" | "baselineCaption"
  >,
): { current: string | null; original: string | null } | null {
  if (overlay.status === null) return null; // new overlays: caption lives on the object, not a delta
  const current = overlay.caption;
  if (current === getEditModeDefaultCaption(overlay)) return null;
  return { current, original: overlay.baselineCaption };
}

// All staged modifications for a project's overlays: corners and caption deltas both derived from
// the live overlay (history for corners, edit-mode default for caption), merged per overlay.
export function getStagedOverlayModifications(projectId: string): PendingOverlayModification[] {
  const modifications: PendingOverlayModification[] = [];
  for (const overlay of Object.values(useOverlayStore().liveOverlays)) {
    if (overlay.projectId !== projectId || overlay.status === null) continue;
    const corners = getStagedCornersDelta(overlay);
    const caption = getStagedCaptionDelta(overlay);
    if (corners) {
      const modification: PendingOverlayModification = { overlayId: overlay.id, corners };
      if (caption) modification.caption = caption;
      modifications.push(modification);
    } else if (caption) {
      modifications.push({ overlayId: overlay.id, caption });
    }
  }
  return modifications;
}

// Fully derived: a new overlay (status null) exists only locally, a submitted one has unsaved
// state exactly when a corners or caption delta is derivable from its live entry. There is no
// stored overlay dirty flag.
export function isOverlayUnsaved(overlay: OverlayLike): boolean {
  if (overlay.status === null) return true;
  const live = useOverlayStore().liveOverlays[overlay.id];
  if (!live) return false;
  return getStagedCornersDelta(live) !== null || getStagedCaptionDelta(live) !== null;
}

export function isProjectUnsaved(project: ProjectLike): boolean {
  if (project.status === null) return true;
  if (useProjectStore().hasProjectDraft(project.id)) return true;
  if (hasStagedRender(project.id)) return true;
  const overlayStore = useOverlayStore();
  return Object.values(overlayStore.liveOverlays).some(
    (o) => o.projectId === project.id && isOverlayUnsaved(o),
  );
}

export function hasUnsavedChanges(): boolean {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();

  if (hasStagedRenders()) return true;
  if (Object.values(overlayStore.liveOverlays).some(isOverlayUnsaved)) return true;
  if (Object.values(projectStore.projects).some(isProjectUnsaved)) return true;
  return false;
}
