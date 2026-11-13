import type { OverlayObject } from "@/types/index";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useUiStore } from "@/stores/uiStore";
import { useModerationStore } from "@/stores/moderationStore";

// Whether the overlay has an open change request as the current mode defines it: any requester's in
// moderation (the country's pending set), otherwise the current user's own proposal.
export function hasOpenChangeRequest(overlay: Pick<OverlayObject, "id" | "ownProposal">): boolean {
  if (useUiStore().mode === "moderation") {
    return useModerationStore().changeRequests.some(
      (cr) => cr.entityType === "overlay" && cr.entityId === overlay.id,
    );
  }
  return overlay.ownProposal !== undefined;
}

// Whether the map shows the suggested (proposed) state of an overlay's open change request.
// Edit mode defaults to it (any state other than the explicit approved-position toggle, so
// caption-only CRs still count). Non-edit modes show the approved state unless an explicit
// moderation preview of the suggested position is active for this overlay.
export function showsSuggestedState(
  overlay: Pick<OverlayObject, "id"> &
    Partial<Pick<OverlayObject, "history" | "showApprovedPosition">>,
): boolean {
  if (useUiStore().mode === "edit") {
    return (overlay.history?.length ?? 0) > 1 || !overlay.showApprovedPosition;
  }
  const preview = useChangeRequestStore().previewState;
  return (
    preview?.side === "suggested" &&
    preview.change.entityType === "overlay" &&
    preview.change.entityId === overlay.id
  );
}
