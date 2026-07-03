// Single source of truth for pending overlay changes (position, caption) across all UI surfaces.
import { defineStore, acceptHMRUpdate } from "pinia";
import { ref } from "vue";
import type { ApprovalStatus } from "@shared/types";

import type { PendingOverlayModification } from "@/types/index";

export const usePendingModificationsStore = defineStore("pendingModifications", () => {
  const modifications = ref<Map<string, PendingOverlayModification>>(new Map());

  // Upsert one field of a modification, creating the entry on first write.
  function upsertModification(
    overlayId: string,
    projectId: string | null,
    overlayStatus: ApprovalStatus,
    field:
      | Pick<PendingOverlayModification, "corners">
      | Pick<PendingOverlayModification, "caption">,
  ): void {
    const existing = modifications.value.get(overlayId);
    if (existing) {
      Object.assign(existing, field);
    } else {
      modifications.value.set(overlayId, { overlayId, projectId, overlayStatus, ...field });
    }
  }

  function saveCornersChange(
    overlayId: string,
    projectId: string | null,
    currentCorners: { lat: number; lng: number }[],
    originalCorners: { lat: number; lng: number }[],
    overlayStatus: ApprovalStatus,
  ): void {
    upsertModification(overlayId, projectId, overlayStatus, {
      corners: { current: currentCorners, original: originalCorners },
    });
  }

  // The delta's original is the caption before the FIRST staged edit, kept across successive
  // edits; returning to it drops the delta so no no-op caption change is ever stored.
  function saveCaptionChange(
    overlayId: string,
    projectId: string | null,
    currentCaption: string | null,
    originalCaption: string | null,
    overlayStatus: ApprovalStatus,
  ): void {
    const existingDelta = modifications.value.get(overlayId)?.caption;
    const baseline = existingDelta ? existingDelta.original : originalCaption;
    if (currentCaption === baseline) {
      clearFieldModification(overlayId, "caption");
      return;
    }
    upsertModification(overlayId, projectId, overlayStatus, {
      caption: { current: currentCaption, original: baseline },
    });
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

  // Removes one field from a modification. Returns false if no modifications remain.
  function clearFieldModification(overlayId: string, field: "caption" | "corners"): boolean {
    const existing = modifications.value.get(overlayId);
    if (!existing) return false;

    if (field === "corners") {
      delete existing.corners;
    } else {
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

  // Clear user-specific state on logout or account switch.
  function clearAllState(): void {
    modifications.value.clear();
  }

  return {
    saveCornersChange,
    saveCaptionChange,
    hasPendingModifications,
    getPendingModifications,
    getModificationsForProject,
    clearFieldModification,
    clearModification,
    clearAllState,
  };
});

// Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePendingModificationsStore, import.meta.hot));
}
