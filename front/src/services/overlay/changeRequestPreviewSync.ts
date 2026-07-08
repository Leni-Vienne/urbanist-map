import { useMapStore } from "@/stores/mapStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import type { PendingChangeRequest } from "@/types/index";

// The change requests that previews can target in the current mode: the country's pending
// submissions in moderation mode, the user's own change requests otherwise.
function relevantChangeRequests(): PendingChangeRequest[] {
  if (useMapStore().mode === "moderation") {
    return useModerationStore().changeRequests;
  }
  return useChangeRequestStore().pendingChangeRequests;
}

/**
 * Sync preview state when navigating to an overlay.
 * Finds geometry change requests for the overlay and updates preview state accordingly.
 */
export function syncPreviewStateOnNavigation(overlayId: string, isViewingApproved: boolean): void {
  const changeRequestStore = useChangeRequestStore();

  // Find geometry change request for this overlay
  const geometryChange = relevantChangeRequests().find(
    (cr) =>
      cr.entityType === "overlay" &&
      cr.entityId === overlayId &&
      (cr.fieldName === "corners" || cr.fieldName === "centroid"),
  );

  if (!geometryChange) {
    changeRequestStore.previewState = { type: "none" };
    return;
  }

  if (isViewingApproved) {
    changeRequestStore.previewState = {
      type: "current",
      changeId: geometryChange.id,
      overlayId,
    };
    return;
  }

  // oxlint-disable-next-line no-unsafe-type-assertion
  const corners = geometryChange.newValue as { lat: number; lng: number }[] | null;
  if (Array.isArray(corners)) {
    changeRequestStore.previewState = {
      type: "suggested",
      changeId: geometryChange.id,
      overlayId,
      corners,
    };
  } else {
    // The suggested position can't be shown without corners, so no preview is active.
    changeRequestStore.previewState = { type: "none" };
  }
}

/**
 * Sync preview state for project shape changes (geometry field).
 * Sets the "view current shapes" button as active by default.
 * Only call this when no overlay is selected (caller's responsibility).
 */
export function syncProjectShapePreviewState(): void {
  const changeRequestStore = useChangeRequestStore();
  const shapesChange = relevantChangeRequests().find(
    (cr) => cr.entityType === "project" && cr.fieldName === "geometry",
  );
  if (shapesChange) {
    changeRequestStore.previewState = {
      type: "project-current",
      changeId: shapesChange.id,
      projectId: shapesChange.entityId,
    };
  } else {
    changeRequestStore.previewState = { type: "none" };
  }
}
