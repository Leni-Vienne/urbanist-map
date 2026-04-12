import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import type { OverlayObject, Project } from "@/types/index";
import { createOverlayObject } from "@/utils/typeFactories";

/**
 * Enrich overlay with project data, falling back to moderation store in moderation mode.
 */
export function enrichOverlayWithProject(savedOverlay: OverlayObject): OverlayObject {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const moderationStore = useModerationStore();
  const mapStore = useMapStore();

  let project: typeof savedOverlay.project | Project = savedOverlay.project ?? null;

  if (!project && savedOverlay.projectId) {
    // First check normal project store
    project = projectStore.projects[savedOverlay.projectId];

    // If not found and in moderation mode, check moderation store
    if (!project && mapStore.mode === "moderation") {
      const modProject = moderationStore.projects.find((p) => p.id === savedOverlay.projectId);
      if (modProject) {
        // Cast moderation project to Project type (compatible enough for our needs)
        project = modProject as unknown as Project;
      }
    }
  }

  // Check edit mode cache to determine if overlay has been modified locally
  const cachedModifications =
    mapStore.mode === "edit" ? overlayStore.getFromEditModeCache(savedOverlay.id) : undefined;

  return createOverlayObject({
    ...savedOverlay,
    project: project ?? null,
    corners: savedOverlay.corners,
    // Set isModified flag based on edit mode cache for proper marker color
    isModified: cachedModifications?.isModified ?? savedOverlay.isModified,
  });
}
