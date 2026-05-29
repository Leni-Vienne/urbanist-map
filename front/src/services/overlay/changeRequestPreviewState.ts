import { ref } from "vue";
import type { PendingChangeRequest } from "@/types/index";

// State machine for position preview
type PreviewState =
  | { type: "none" }
  | { type: "current"; changeId: string; overlayId: string }
  | {
      type: "suggested";
      changeId: string;
      overlayId: string;
      corners: { lat: number; lng: number }[];
    }
  | { type: "project-current"; changeId: string; projectId: string }
  | { type: "project-suggested"; changeId: string; projectId: string };

export const previewState = ref<PreviewState>({ type: "none" });

let allChangeRequestsRef: PendingChangeRequest[] = [];

/** Set the change requests reference used by syncPreviewStateOnNavigation. */
export function setChangeRequestsForPreview(changeRequests: PendingChangeRequest[]): void {
  allChangeRequestsRef = changeRequests;
}

/**
 * Sync preview state when navigating to an overlay.
 * Finds geometry change requests for the overlay and updates preview state accordingly.
 */
export function syncPreviewStateOnNavigation(overlayId: string, isViewingApproved: boolean): void {
  // Find geometry change request for this overlay
  const geometryChange = allChangeRequestsRef.find(
    (cr) =>
      cr.entityType === "overlay" &&
      cr.entityId === overlayId &&
      (cr.fieldName === "corners" || cr.fieldName === "centroid"),
  );

  if (!geometryChange) {
    previewState.value = { type: "none" };
    return;
  }

  if (isViewingApproved) {
    previewState.value = {
      type: "current",
      changeId: geometryChange.id,
      overlayId,
    };
  } else {
    const corners = geometryChange.newValue as { lat: number; lng: number }[] | null;
    if (corners && Array.isArray(corners)) {
      previewState.value = {
        type: "suggested",
        changeId: geometryChange.id,
        overlayId,
        corners,
      };
    }
  }
}

/**
 * Sync preview state for project shape changes (geometry field).
 * Sets the "view current shapes" button as active by default.
 * Only call this when no overlay is selected (caller's responsibility).
 */
export function syncProjectShapePreviewState(changeRequests: PendingChangeRequest[]): void {
  const shapesChange = changeRequests.find(
    (cr) => cr.entityType === "project" && cr.fieldName === "geometry",
  );
  if (shapesChange) {
    previewState.value = {
      type: "project-current",
      changeId: shapesChange.id,
      projectId: shapesChange.entityId,
    };
  } else {
    previewState.value = { type: "none" };
  }
}
