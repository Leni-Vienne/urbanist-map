import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import { addNewOverlayToCityCache } from "@/services/overlay/overlayCityCache";
import { map } from "@/services/core/map";
import { trpc, getApiUrl } from "@/client";
import type { OverlayObject, Project } from "@/types/index";
import { validateOverlaySize, leafletCornersToCorners } from "@shared/overlayValidation";
import { projectSchema } from "@shared/validation/schemas";
import { t } from "@/locales";
import { useAuthStore } from "@/stores/authStore";
import { getLayer, renameEntry } from "@/services/overlay/overlayRenderRegistry";

// Extract corners from overlay object, falling back to stored corners if needed
function getCornersFromOverlay(overlay: OverlayObject) {
  const layer = getLayer(overlay.id);
  if (layer) {
    return layer.getCorners();
  }
  return overlay.corners;
}

export function useOverlayPublisher() {
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Validate if overlay can be published
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
      // Simple i18n error message
      throw new Error(t("overlay.overlayTooLarge"));
    }

    return true;
  }

  // Ensure project exists on server and handle project publishing
  async function ensureProjectOnServer(project: Project): Promise<boolean> {
    try {
      // For approved projects, skip publishing - they already exist on server
      // Project modifications will be handled separately via change request flow
      if (project.status === "approved") {
        return false; // Project ID won't change for existing approved projects
      }

      // Use shared helper to build consistent payload
      const projectResult = await trpc.project.publishProject.mutate(projectSchema.parse(project));

      // Handle project ID update and IndexedDB cleanup if this is a new project
      if (projectResult.id) {
        const oldProjectId = project.id;

        // If this is a new project (not existing), update the project ID
        if (!projectResult.exists && projectResult.id !== oldProjectId) {
          // Update the project ID with the one from the backend
          project.id = projectResult.id;

          // Update project ID in the projects store
          const updatedProjects = { ...projectStore.projects };
          delete updatedProjects[oldProjectId];
          updatedProjects[projectResult.id] = project;
          projectStore.projects = updatedProjects;

          return true; // Indicates project ID changed
        }

        // For newly created projects, add to contributions optimistically
        if (!projectResult.exists) {
          // Update status locally to match backend
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

  // Prepare image for server (upload or extract filename)
  // Images are uploaded to local storage immediately, then migrated to R2 only after moderator approval
  async function prepareImageForServer(overlay: OverlayObject): Promise<string> {
    if (overlay.imageUrl.startsWith("data:")) {
      // Convert data URL to Blob with proper MIME type
      const response = await fetch(overlay.imageUrl);
      const blob = await response.blob();

      // Validate file size before upload (10MB limit matches backend)
      const MAX_FILE_SIZE_MB = 10;
      const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
      if (blob.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(t("upload.fileTooLarge", { maxSize: MAX_FILE_SIZE_MB }));
      }

      // Create a File object with proper name and type
      const file = new File([blob], "overlay-image.webp", { type: blob.type || "image/webp" });

      const formData = new FormData();
      formData.append("image", file);

      // Get API URL based on environment (same logic as tRPC client)
      // Use shared getApiUrl function
      // Upload to server's local storage - will migrate to R2 on approval

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

  // Synchronize overlay ID change across all stores and references
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

  // Handle post-publish UI updates and cache invalidation
  function handlePostPublishUpdates(
    overlay: OverlayObject,
    project: Project | null,
    filename: string,
  ): void {
    // Update marker tooltip to reflect new published state
    updateMarkerTooltip(overlay);

    // Ensure the overlay stays visible on the map after ID change
    const layer = getLayer(overlay.id);
    if (layer && !map.value.hasLayer(layer)) {
      layer.addTo(map.value);
    }

    // Update cache with new overlay state to refresh marker color (changes from Orange to Yellow)
    // Use robust resolution for cityId as overlay.project might not be fully hydrated
    const cityId = overlay.project?.cityId ?? project?.cityId;

    if (cityId) {
      // Update the overlay in the cache to reflect the new status (yellow/pending instead of orange/modified)
      // This ensures markers at low zoom levels are correct immediately without needing a reload
      addNewOverlayToCityCache(overlay, cityId);

      // Clear standalone cache to ensure project markers are updated correctly (removed if now has overlays)
      mapStore.clearCityStandaloneProjectsCache(cityId);
    }

    // Optimistically add overlay to user contributions (no backend fetch needed)
    // Latest overlays won't show pending submissions, so don't refresh that panel
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

  // Main publish overlay function - orchestrates the publishing workflow
  async function publishOverlay(overlay: OverlayObject, project: Project | null): Promise<void> {
    if (!validateOverlayForPublishing(overlay, project)) {
      return;
    }

    try {
      // Step 1 - Ensure project exists on server first (only for brand new projects)
      // Skip if project is already published (pending/approved) to avoid duplicate publishProject calls
      let projectIdChanged = false;
      if (project?.status === null) {
        projectIdChanged = await ensureProjectOnServer(project);
        if (projectIdChanged) {
          overlay.projectId = project.id;
        }
      }
      // Step 2 - Prepare and upload image if needed
      const filename = await prepareImageForServer(overlay);

      // Step 3 - Publish overlay metadata
      if (!overlay.projectId) {
        throw new Error("Cannot publish overlay: projectId is required");
      }

      const corners = getCornersFromOverlay(overlay);
      const payload = {
        id: overlay.id,
        filename: filename,
        caption: overlay.caption ?? undefined,
        projectId: overlay.projectId,
        replacesOverlayId: overlay.replacesOverlayId ?? undefined,
        corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })),
      };

      const publishResult = await trpc.overlay.publishOverlay.mutate(payload);

      // Step 4 - Handle successful publish result
      if (publishResult.id) {
        const oldId = overlay.id;
        const newId = publishResult.id;

        // Update overlay properties with server response
        overlay.id = newId;
        overlay.status = publishResult.status;
        overlay.authorId = publishResult.authorId ?? null;
        overlay.isModified = false;

        // CRITICAL: Update imageUrl to server URL to prevent re-upload on next save
        // Build the server URL from the filename
        // Use /uploads/ path as that's where the backend serves files (there is no /api/images endpoint)
        overlay.imageUrl = `${getApiUrl()}/uploads/${filename}`;
        overlay.filename = filename; // Update filename to the clean one returned by server

        // Synchronize ID change across all stores if ID changed
        if (oldId !== newId) {
          synchronizeOverlayIdChange(overlay, oldId, newId, project);
        }

        // Handle post-publish UI updates and cache invalidation
        handlePostPublishUpdates(overlay, project, filename);
      }

      // Don't refresh city overlays immediately after publishing to avoid overwriting
      // the just-published overlay with stale backend data. The overlay is already
      // updated locally with the correct state and ID from the publish response.
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
