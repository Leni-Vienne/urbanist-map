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

// Store reference to all change requests for syncing preview state on navigation
let allChangeRequestsRef: PendingChangeRequest[] = [];

/**
 * Set change requests reference for preview state syncing
 */
export function setChangeRequestsForPreview(changeRequests: PendingChangeRequest[]): void {
  allChangeRequestsRef = changeRequests;
}

/**
 * Sync preview state when navigating to an overlay.
 * Finds geometry change requests for the overlay and updates preview state accordingly
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
    // No geometry change request found, clear preview state
    previewState.value = { type: "none" };
    return;
  }

  // Update preview state based on which position is being viewed
  if (isViewingApproved) {
    previewState.value = {
      type: "current",
      changeId: geometryChange.id,
      overlayId,
    };
  } else {
    // For suggested position, we need the corners from the change request
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

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
