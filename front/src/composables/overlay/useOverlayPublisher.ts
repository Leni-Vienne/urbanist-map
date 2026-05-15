import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import { map } from "@/services/core/map";
import { trpc, getApiUrl } from "@/client";
import type { OverlayObject, Project } from "@/types/index";
import { validateOverlaySize, leafletCornersToCorners } from "@shared/overlayValidation";
import { projectSchema } from "@shared/validation/schemas";
import { t } from "@/locales";
import { useAuthStore } from "@/stores/authStore";
import { getLayer } from "@/services/overlay/overlayRenderRegistry";

// Extract corners from overlay object, falling back to stored corners if layer isn't ready
function getCornersFromOverlay(overlay: OverlayObject) {
  const layer = getLayer(overlay.id);
  if (layer) {
    const corners = layer.getCorners();
    if (corners) return corners;
  }
  return overlay.corners;
}

export function useOverlayPublisher() {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();

  function validateOverlayForPublishing(overlay: OverlayObject, project: Project | null): boolean {
    if (!project) {
      throw new Error("Cannot Publish: Overlay must be assigned to a project");
    }

    const corners = getCornersFromOverlay(overlay);
    if (corners.length !== 4 || corners.some((c) => !c.lat || !c.lng)) {
      throw new Error("Cannot Publish: Overlay must have valid position (4 corners)");
    }

    // Validate overlay size constraints
    const cornersArray = leafletCornersToCorners(corners);
    const sizeValidation = validateOverlaySize(cornersArray);

    if (!sizeValidation.isValid) {
      throw new Error(t("overlay.overlayTooLarge"));
    }

    return true;
  }

  async function ensureProjectOnServer(project: Project): Promise<void> {
    try {
      // Approved projects already exist on the server; changes go through the change-request flow.
      if (project.status === "approved") {
        return;
      }

      const projectResult = await trpc.project.publishProject.mutate(projectSchema.parse(project));

      // The backend upserts on the supplied UUID, so projectResult.id always matches project.id.
      // Newly-inserted projects (exists === false) need their local status flipped to pending and
      // a contributions-cache entry so the sidebar reflects the submission.
      if (projectResult.id && !projectResult.exists) {
        projectStore.updateProject(project.id, { status: "pending" });
        const updatedProject = projectStore.projects[project.id];
        if (updatedProject) {
          projectStore.addProjectToUserContributions(updatedProject);
        }
      }
    } catch (error) {
      console.error(`Failed to publish project "${project.name}" to server:`, error);
      throw error;
    }
  }

  // Images upload to local storage first and migrate to R2 only after moderator approval.
  async function prepareImageForServer(overlay: OverlayObject): Promise<string> {
    if (overlay.imageUrl.startsWith("data:")) {
      const response = await fetch(overlay.imageUrl);
      const blob = await response.blob();

      const MAX_FILE_SIZE_MB = 10;
      const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
      if (blob.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(t("upload.fileTooLarge", { maxSize: MAX_FILE_SIZE_MB }));
      }

      const file = new File([blob], "overlay-image.webp", { type: blob.type || "image/webp" });

      const formData = new FormData();
      formData.append("image", file);

      const uploadResponse = await fetch(`${getApiUrl()}/api/upload-image`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload image to server");
      }
      const uploadResult: { filename: string } = await uploadResponse.json();

      return uploadResult.filename;
    } else {
      // Extract filename from existing server URL
      const urlParts = overlay.imageUrl.split("/");
      const filename = urlParts[urlParts.length - 1];

      if (!filename) {
        throw new Error("Could not extract filename from URL");
      }

      return filename;
    }
  }

  function handlePostPublishUpdates(
    overlay: OverlayObject,
    project: Project | null,
    filename: string,
  ): void {
    updateMarkerTooltip(overlay);

    const layer = getLayer(overlay.id);
    if (layer && !map.value.hasLayer(layer)) {
      layer.addTo(map.value);
      // If this overlay is selected, bring to front; otherwise keep the selected one on top.
      requestAnimationFrame(() => {
        if (overlayStore.idSelectedOverlay === overlay.id) {
          layer.bringToFront();
        } else if (overlayStore.idSelectedOverlay) {
          const selectedLayer = getLayer(overlayStore.idSelectedOverlay);
          if (selectedLayer) {
            selectedLayer.bringToFront();
          }
        }
      });
    }

    if (project) {
      const authStore = useAuthStore();
      projectStore.addOverlayToUserContributions(
        overlay,
        project,
        filename,
        authStore.user?.username ?? null,
      );
    }
  }

  async function publishOverlay(overlay: OverlayObject, project: Project | null): Promise<void> {
    if (!validateOverlayForPublishing(overlay, project)) {
      return;
    }

    try {
      // For brand-new projects, publish the project first so the overlay can reference it.
      if (project?.status === null) {
        await ensureProjectOnServer(project);
      }

      const filename = await prepareImageForServer(overlay);

      if (!overlay.projectId) {
        throw new Error("Cannot publish overlay: projectId is required");
      }

      const corners = getCornersFromOverlay(overlay);
      const payload = {
        id: overlay.id,
        filename,
        caption: overlay.caption ?? undefined,
        projectId: overlay.projectId,
        replacesOverlayId: overlay.replacesOverlayId ?? undefined,
        corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })),
      };

      const publishResult = await trpc.overlay.publishOverlay.mutate(payload);

      if (publishResult.id) {
        overlay.status = publishResult.status;
        overlay.authorId = publishResult.authorId ?? null;
        overlay.isModified = false;

        // Point to the server URL so the image isn't re-uploaded on the next save.
        // The backend serves uploads under /uploads/ (no /api/images endpoint exists).
        overlay.imageUrl = `${getApiUrl()}/uploads/${filename}`;
        overlay.filename = filename;

        handlePostPublishUpdates(overlay, project, filename);
      }

      // Don't reload city overlays immediately, the local state already reflects the
      // publish response and a refetch would overwrite it with stale backend data.
    } catch (error) {
      console.error("Failed to publish overlay:", error);
      throw error;
    }
  }

  return {
    publishOverlay,
  };
}
