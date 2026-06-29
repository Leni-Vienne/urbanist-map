import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import type { OverlayObject, Project } from "@/types/index";
import { createOverlayObject } from "@/utils/typeFactories";
import { isValidQuad } from "@/services/overlay/transform";
import { getOverlayImageCorners } from "@/services/overlay/mapLayers";

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
    isModified: liveOverlay?.isModified ?? savedOverlay.isModified,
  });
}

// Corners to (re)create and hit-test the overlay IMAGE at, biased toward the remembered/intended
// position: history > backend corners > live image. In view mode, approved overlays render at
// their backend corners but keep history, so edit mode can restore in-progress edits.
// Deliberately the inverse of resolveOverlayMarkerCorners, which places the marker on the LIVE
// image and so prefers the live position first; both share isValidQuad.
export function resolveOverlayRenderCorners(overlayObject: OverlayObject) {
  const mapStore = useMapStore();
  const ignoreHistory = mapStore.mode === "view" && overlayObject.status === "approved";

  if (!ignoreHistory && overlayObject.history.length > 0) {
    const lastCorners = overlayObject.history.at(-1)?.corners;
    if (isValidQuad(lastCorners)) return lastCorners;
  }

  // Skip all-zero corners, which indicates a freshly created overlay with no position yet
  const stored = overlayObject.corners;
  const isUnplaced = stored.every((c) => c.lat === 0 && c.lng === 0);
  if (!isUnplaced && isValidQuad(stored)) return stored;

  return getOverlayImageCorners(overlayObject.id);
}
