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
import { getLayer, renameEntry } from "@/services/overlay/overlayRenderRegistry";

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

  async function ensureProjectOnServer(project: Project): Promise<boolean> {
    try {
      // Approved projects already exist on the server; changes go through the change-request flow.
      if (project.status === "approved") {
        return false;
      }

      const projectResult = await trpc.project.publishProject.mutate(projectSchema.parse(project));

      if (projectResult.id) {
        const oldProjectId = project.id;

        if (!projectResult.exists && projectResult.id !== oldProjectId) {
          project.id = projectResult.id;

          const updatedProjects = { ...projectStore.projects };
          delete updatedProjects[oldProjectId];
          updatedProjects[projectResult.id] = project;
          projectStore.projects = updatedProjects;

          return true;
        }

        if (!projectResult.exists) {
          projectStore.updateProject(project.id, { status: "pending" });
          const updatedProject = projectStore.projects[project.id];
          if (updatedProject) {
            projectStore.addProjectToUserContributions(updatedProject);
          }
        }
      }

      return false; // Project ID didn't change
    } catch (error) {
      const errorMessage = `Failed to publish project "${project.name}" to server: ${error instanceof Error ? error.message : String(error)}`;
      throw new Error(errorMessage, { cause: error });
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

  function synchronizeOverlayIdChange(
    overlay: OverlayObject,
    oldId: string,
    newId: string,
    project: Project | null,
  ): void {
    // Update overlays store with new key
    const updatedOverlays = { ...overlayStore.overlays };
    delete updatedOverlays[oldId];
    updatedOverlays[newId] = overlay;
    overlayStore.overlays = updatedOverlays;

    // Move the registry entry (layer + marker) from old ID to new ID
    renameEntry(oldId, newId);

    // Update project's overlayIds array to use new ID
    if (project?.id) {
      const storedProject = projectStore.projects[project.id];
      if (storedProject) {
        const overlayIndex = storedProject.overlayIds.indexOf(oldId);

        if (overlayIndex !== -1) {
          const updatedOverlayIds = [...storedProject.overlayIds];
          updatedOverlayIds[overlayIndex] = newId;

          const updatedProjects = { ...projectStore.projects };
          updatedProjects[project.id] = {
            ...storedProject,
            overlayIds: updatedOverlayIds,
          };
          projectStore.projects = updatedProjects;
        }
      }
    }

    // Update selected overlay ID if this was the selected one
    if (overlayStore.idSelectedOverlay === oldId) {
      overlayStore.idSelectedOverlay = newId;
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
      // For brand-new projects, publish the project first so we have a server-side ID.
      let projectIdChanged = false;
      if (project?.status === null) {
        projectIdChanged = await ensureProjectOnServer(project);
        if (projectIdChanged) {
          overlay.projectId = project.id;
        }
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
        const oldId = overlay.id;
        const newId = publishResult.id;

        overlay.id = newId;
        overlay.status = publishResult.status;
        overlay.authorId = publishResult.authorId ?? null;
        overlay.isModified = false;

        // Point to the server URL so the image isn't re-uploaded on the next save.
        // The backend serves uploads under /uploads/ (no /api/images endpoint exists).
        overlay.imageUrl = `${getApiUrl()}/uploads/${filename}`;
        overlay.filename = filename;

        if (oldId !== newId) {
          synchronizeOverlayIdChange(overlay, oldId, newId, project);
        }

        handlePostPublishUpdates(overlay, project, filename);
      }

      // Don't reload city overlays immediately, the local state already reflects the
      // publish response and a refetch would overwrite it with stale backend data.
    } catch (error) {
      console.error("Failed to publish overlay:", error);
      throw new Error("Publish Failed: Failed to save to server. Please try again.", {
        cause: error,
      });
    }
  }

  return {
    publishOverlay,
  };
}
