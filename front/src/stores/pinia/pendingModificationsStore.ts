// Single source of truth for pending overlay changes (position, caption) across all UI surfaces.
import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import type { ApprovalStatus } from "@shared/types";

type CornersChange = {
  current: { lat: number; lng: number }[];
  original: { lat: number; lng: number }[];
};

type CaptionChange = {
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
  const modifications = ref<Map<string, PendingOverlayModification>>(new Map());

  function saveCornersChange(
    overlayId: string,
    projectId: string | null,
    currentCorners: { lat: number; lng: number }[],
    originalCorners: { lat: number; lng: number }[],
    overlayStatus: ApprovalStatus,
  ) {
    const existing = modifications.value.get(overlayId);

    if (existing) {
      existing.corners = { current: currentCorners, original: originalCorners };
    } else {
      modifications.value.set(overlayId, {
        overlayId,
        projectId,
        overlayStatus,
        corners: { current: currentCorners, original: originalCorners },
      });
    }
  }

  function saveCaptionChange(
    overlayId: string,
    projectId: string | null,
    currentCaption: string | null,
    originalCaption: string | null,
    overlayStatus: ApprovalStatus,
  ): void {
    const existing = modifications.value.get(overlayId);

    if (existing) {
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

  function hasPendingModifications(overlayId: string): boolean {
    return modifications.value.has(overlayId);
  }

  function getPendingModifications(overlayId: string): PendingOverlayModification | undefined {
    return modifications.value.get(overlayId);
  }

  function getModificationsForProject(projectId: string): PendingOverlayModification[] {
    return [...modifications.value.values()].filter((mod) => mod.projectId === projectId);
  }

  // Returns the count of modified overlays for a project (for UI indicators).
  function getModificationCountForProject(projectId: string): number {
    return getModificationsForProject(projectId).length;
  }

  // Removes one field from a modification. Returns false if no modifications remain.
  function clearFieldModification(overlayId: string, field: "caption" | "corners"): boolean {
    const existing = modifications.value.get(overlayId);
    if (!existing) return false;

    if (field === "corners") {
      delete existing.corners;
    } else if (field === "caption") {
      delete existing.caption;
    }

    if (!existing.corners && !existing.caption) {
      modifications.value.delete(overlayId);
      return false;
    }

    return true;
  }

  function clearModification(overlayId: string): void {
    modifications.value.delete(overlayId);
  }

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
