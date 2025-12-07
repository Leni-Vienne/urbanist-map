import { ref } from "vue";
import type { PendingChangeRequest } from "../../types/api";

// AI : State machine for position preview
// AI : Extracted to separate file to avoid circular dependency between
// AI : useChangeRequestPreview.ts <-> useOverlayModes.ts
export type PreviewState =
  | { type: "none" }
  | { type: "current"; changeId: string; overlayId: string }
  | {
      type: "suggested";
      changeId: string;
      overlayId: string;
      corners: { lat: number; lng: number }[];
    };

export const previewState = ref<PreviewState>({ type: "none" });

// AI : Store reference to all change requests for syncing preview state on navigation
let allChangeRequestsRef: PendingChangeRequest[] = [];

/**
 * AI : Set change requests reference for preview state syncing
 */
export function setChangeRequestsForPreview(changeRequests: PendingChangeRequest[]): void {
  allChangeRequestsRef = changeRequests;
}

/**
 * AI : Clear preview state (standalone function, can be called outside composable context)
 * AI : This is safe because it only mutates module-level state without using composable features
 */
export function clearChangeRequestPreview(): void {
  previewState.value = { type: "none" };
}

/**
 * AI : Sync preview state when navigating to an overlay.
 * Finds geometry change requests for the overlay and updates preview state accordingly
 */
export function syncPreviewStateOnNavigation(overlayId: string, isViewingApproved: boolean): void {
  // AI : Find geometry change request for this overlay
  const geometryChange = allChangeRequestsRef.find(
    (cr) =>
      cr.entityType === "overlay" &&
      cr.entityId === overlayId &&
      (cr.fieldName === "corners" || cr.fieldName === "centroid"),
  );

  if (!geometryChange) {
    // AI : No geometry change request found, clear preview state
    previewState.value = { type: "none" };
    return;
  }

  // AI : Update preview state based on which position is being viewed
  if (isViewingApproved) {
    previewState.value = {
      type: "current",
      changeId: geometryChange.id,
      overlayId,
    };
  } else {
    // AI : For suggested position, we need the corners from the change request
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
