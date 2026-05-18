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
        project = modProject;
      }
    }
  }

  // In edit mode, prefer the live OverlayObject's isModified flag so marker color
  // reflects user edits even before the savedOverlay snapshot has been refreshed.
  const liveOverlay = mapStore.mode === "edit" ? overlayStore.overlays[savedOverlay.id] : undefined;

  return createOverlayObject({
    ...savedOverlay,
    project: project ?? null,
    corners: savedOverlay.corners,
    isModified: liveOverlay?.isModified ?? savedOverlay.isModified,
  });
}
