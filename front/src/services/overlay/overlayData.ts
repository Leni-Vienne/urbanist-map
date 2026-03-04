// ============================================================================
// OVERLAY DATA - Data enrichment and transformation
// ============================================================================
// Extracted from overlayMarkers.ts to handle data hydration and enrichment
// ============================================================================

import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import type { OverlayObject, Project } from "@/types/index";
import { createOverlayObject } from "@/utils/typeFactories";

/**
 * Enrich overlay with project data
 * Pure function - only uses stores and factory utilities
 */
export function enrichOverlayWithProject(savedOverlay: OverlayObject): OverlayObject {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const moderationStore = useModerationStore();

  let project = savedOverlay.project;

  if (!project && savedOverlay.projectId) {
    // First check normal project store
    project = projectStore.projects[savedOverlay.projectId];

    // If not found and in moderation mode, check moderation store
    if (!project && overlayStore.mode === "moderation") {
      const modProject = moderationStore.projects.find((p) => p.id === savedOverlay.projectId);
      if (modProject) {
        // Cast moderation project to Project type (compatible enough for our needs)
        project = modProject as unknown as Project;
      }
    }
  }

  // Check edit mode cache to determine if overlay has been modified locally
  const cachedModifications =
    overlayStore.mode === "edit" ? overlayStore.getFromEditModeCache(savedOverlay.id) : undefined;

  // Use factory function but preserve existing data
  return createOverlayObject({
    ...savedOverlay,
    project: project ? { ...project, city: project.city } : null,
    corners: savedOverlay.corners,
    // Set isModified flag based on edit mode cache for proper marker color
    isModified: cachedModifications?.isModified ?? savedOverlay.isModified,
  });
}
