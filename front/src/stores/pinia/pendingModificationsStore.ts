// AI : Unified store for tracking pending overlay modifications
// AI : Single source of truth for all overlay changes (position, caption) from any UI surface
import { defineStore } from "pinia";
import { ref, computed } from "vue";

// AI : Types for tracking modifications
export type CornersChange = {
  current: { lat: number; lng: number }[];
  original: { lat: number; lng: number }[];
};

export type CaptionChange = {
  current: string;
  original: string | null;
};

export type PendingOverlayModification = {
  overlayId: string;
  projectId: string | null;
  overlayStatus: "pending" | "approved" | "rejected";
  corners?: CornersChange;
  caption?: CaptionChange;
};

export const usePendingModificationsStore = defineStore("pendingModifications", () => {
  // AI : Central map of overlay ID → pending modifications
  const modifications = ref<Map<string, PendingOverlayModification>>(new Map());

  // AI : Save a corners (position) change
  function saveCornersChange(
    overlayId: string,
    projectId: string | null,
    currentCorners: { lat: number; lng: number }[],
    originalCorners: { lat: number; lng: number }[],
    overlayStatus: "pending" | "approved" | "rejected",
  ): void {
    const existing = modifications.value.get(overlayId);

    if (existing) {
      // AI : Update existing modification with corners
      existing.corners = { current: currentCorners, original: originalCorners };
    } else {
      // AI : Create new modification entry
      modifications.value.set(overlayId, {
        overlayId,
        projectId,
        overlayStatus,
        corners: { current: currentCorners, original: originalCorners },
      });
    }
  }

  // AI : Save a caption change
  function saveCaptionChange(
    overlayId: string,
    projectId: string | null,
    currentCaption: string,
    originalCaption: string | null,
    overlayStatus: "pending" | "approved" | "rejected",
  ): void {
    const existing = modifications.value.get(overlayId);

    if (existing) {
      // AI : Update existing modification with caption
      existing.caption = { current: currentCaption, original: originalCaption };
    } else {
      // AI : Create new modification entry
      modifications.value.set(overlayId, {
        overlayId,
        projectId,
        overlayStatus,
        caption: { current: currentCaption, original: originalCaption },
      });
    }
  }

  // AI : Check if overlay has any pending modifications
  function hasPendingModifications(overlayId: string): boolean {
    return modifications.value.has(overlayId);
  }

  // AI : Get pending modifications for a specific overlay
  function getPendingModifications(overlayId: string): PendingOverlayModification | undefined {
    return modifications.value.get(overlayId);
  }

  // AI : Get all modified overlay IDs
  function getModifiedOverlayIds(): string[] {
    return [...modifications.value.keys()];
  }

  // AI : Get all modifications for overlays belonging to a specific project
  function getModificationsForProject(projectId: string): PendingOverlayModification[] {
    return [...modifications.value.values()].filter((mod) => mod.projectId === projectId);
  }

  // AI : Get count of modifications for a project (for UI indicators)
  function getModificationCountForProject(projectId: string): number {
    return getModificationsForProject(projectId).length;
  }

  // AI : Clear a specific field modification for an overlay (caption or corners)
  // AI : Returns true if the overlay still has other modifications, false if it was removed entirely
  function clearFieldModification(overlayId: string, field: "caption" | "corners"): boolean {
    const existing = modifications.value.get(overlayId);
    if (!existing) return false;

    // AI : Remove the specific field
    if (field === "corners") {
      delete existing.corners;
    } else if (field === "caption") {
      delete existing.caption;
    }

    // AI : If no more modifications remain, remove the entire entry
    if (!existing.corners && !existing.caption) {
      modifications.value.delete(overlayId);
      return false;
    }

    return true;
  }

  // AI : Clear modification for a specific overlay (after successful submission)
  function clearModification(overlayId: string): void {
    modifications.value.delete(overlayId);
  }

  // AI : Clear all pending modifications
  function clearAllModifications(): void {
    modifications.value.clear();
  }

  // AI : Check if there are any pending modifications at all
  const hasAnyModifications = computed(() => modifications.value.size > 0);

  // AI : Get total count of modified overlays
  const modifiedOverlayCount = computed(() => modifications.value.size);

  return {
    // State
    modifications,

    // Getters
    hasAnyModifications,
    modifiedOverlayCount,

    // Actions
    saveCornersChange,
    saveCaptionChange,
    hasPendingModifications,
    getPendingModifications,
    getModifiedOverlayIds,
    getModificationsForProject,
    getModificationCountForProject,
    clearFieldModification,
    clearModification,
    clearAllModifications,
  };
});
