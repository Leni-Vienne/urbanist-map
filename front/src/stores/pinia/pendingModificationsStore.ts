// Unified store for tracking pending overlay modifications
// Single source of truth for all overlay changes (position, caption) from any UI surface
import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import type { ApprovalStatus } from "@shared/types";

// Types for tracking modifications
export type CornersChange = {
  current: { lat: number; lng: number }[];
  original: { lat: number; lng: number }[];
};

export type CaptionChange = {
  current: string | null;
  original: string | null;
};

export type PendingOverlayModification = {
  overlayId: string;
  projectId: string | null;
  overlayStatus: ApprovalStatus;
  corners?: CornersChange;
  caption?: CaptionChange;
};

export const usePendingModificationsStore = defineStore("pendingModifications", () => {
  // Central map of overlay ID → pending modifications
  const modifications = ref<Map<string, PendingOverlayModification>>(new Map());

  // Save a corners (position) change
  function saveCornersChange(
    overlayId: string,
    projectId: string | null,
    currentCorners: { lat: number; lng: number }[],
    originalCorners: { lat: number; lng: number }[],
    overlayStatus: ApprovalStatus,
  ) {
    const existing = modifications.value.get(overlayId);

    if (existing) {
      // Update existing modification with corners
      existing.corners = { current: currentCorners, original: originalCorners };
    } else {
      // Create new modification entry
      modifications.value.set(overlayId, {
        overlayId,
        projectId,
        overlayStatus,
        corners: { current: currentCorners, original: originalCorners },
      });
    }
  }

  // Save a caption change
  function saveCaptionChange(
    overlayId: string,
    projectId: string | null,
    currentCaption: string | null,
    originalCaption: string | null,
    overlayStatus: ApprovalStatus,
  ): void {
    const existing = modifications.value.get(overlayId);

    if (existing) {
      // Update existing modification with caption
      existing.caption = { current: currentCaption, original: originalCaption };
    } else {
      // Create new modification entry
      modifications.value.set(overlayId, {
        overlayId,
        projectId,
        overlayStatus,
        caption: { current: currentCaption, original: originalCaption },
      });
    }
  }

  // Check if overlay has any pending modifications
  function hasPendingModifications(overlayId: string): boolean {
    return modifications.value.has(overlayId);
  }

  // Get pending modifications for a specific overlay
  function getPendingModifications(overlayId: string): PendingOverlayModification | undefined {
    return modifications.value.get(overlayId);
  }

  // Get all modifications for overlays belonging to a specific project
  function getModificationsForProject(projectId: string): PendingOverlayModification[] {
    return [...modifications.value.values()].filter((mod) => mod.projectId === projectId);
  }

  // Get count of modifications for a project (for UI indicators)
  function getModificationCountForProject(projectId: string): number {
    return getModificationsForProject(projectId).length;
  }

  // Clear a specific field modification for an overlay (caption or corners)
  // Returns true if the overlay still has other modifications, false if it was removed entirely
  function clearFieldModification(overlayId: string, field: "caption" | "corners"): boolean {
    const existing = modifications.value.get(overlayId);
    if (!existing) return false;

    // Remove the specific field
    if (field === "corners") {
      delete existing.corners;
    } else if (field === "caption") {
      delete existing.caption;
    }

    // If no more modifications remain, remove the entire entry
    if (!existing.corners && !existing.caption) {
      modifications.value.delete(overlayId);
      return false;
    }

    return true;
  }

  // Clear modification for a specific overlay (after successful submission)
  function clearModification(overlayId: string): void {
    modifications.value.delete(overlayId);
  }

  // Check if there are any pending modifications at all
  const hasAnyModifications = computed(() => modifications.value.size > 0);

  return {
    // State
    modifications,

    // Getters
    hasAnyModifications,

    // Actions
    saveCornersChange,
    saveCaptionChange,
    hasPendingModifications,
    getPendingModifications,
    getModificationsForProject,
    getModificationCountForProject,
    clearFieldModification,
    clearModification,
  };
});

// Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePendingModificationsStore, import.meta.hot));
}
