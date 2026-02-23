import { ref } from "vue";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import { addNewOverlayToCityCache } from "@/services/overlay/overlayCityCache";
import { map } from "@/services/core/map";
import { trpc, getApiUrl } from "@/client";
import { buildProjectPayload } from "@/services/project/projectMutations";
import type { OverlayObject, Project } from "@/types/index";
import { validateOverlaySize, leafletCornersToCorners } from "@shared/overlayValidation";
import { t } from "@/locales";
import { useAuthStore } from "@/stores/authStore";

// AI : Extract corners from overlay object, falling back to stored corners if needed
function getCornersFromOverlay(overlay: OverlayObject) {
  if (overlay.overlay) {
    return overlay.overlay.getCorners();
  }
  return overlay.corners;
}

export function useOverlayPublisher() {
  const isPublishing = ref(false);
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // AI : Validate if overlay can be published
  function validateOverlayForPublishing(overlay: OverlayObject, project: Project | null): boolean {
    if (!project) {
      throw new Error("Cannot Publish: Overlay must be assigned to a project");
    }

    const corners = getCornersFromOverlay(overlay);
    if (corners.length !== 4 || corners.some((c) => !c.lat || !c.lng)) {
      throw new Error("Cannot Publish: Overlay must have valid position (4 corners)");
    }

    // AI : Validate overlay size constraints
    const cornersArray = leafletCornersToCorners(corners);
    const sizeValidation = validateOverlaySize(cornersArray);

    if (!sizeValidation.isValid) {
      // AI : Simple i18n error message
      throw new Error(t("overlay.overlayTooLarge"));
    }

    return true;
  }

  // AI : Ensure project exists on server and handle project publishing
  async function ensureProjectOnServer(project: Project): Promise<boolean> {
    try {
      // AI : For approved projects, skip publishing - they already exist on server
      // AI : Project modifications will be handled separately via change request flow
      if (project.status === "approved") {
        return false; // AI : Project ID won't change for existing approved projects
      }

      // AI : Use shared helper to build consistent payload
      const projectResult = await trpc.project.publishProject.mutate(buildProjectPayload(project));

      // AI : Handle project ID update and IndexedDB cleanup if this is a new project
      if (projectResult.id) {
        const oldProjectId = project.id;

        // AI : If this is a new project (not existing), update the project ID
        if (!projectResult.exists && projectResult.id !== oldProjectId) {
          // AI : Update the project ID with the one from the backend
          project.id = projectResult.id;

          // AI : Update project ID in the projects store
          const updatedProjects = { ...projectStore.projects };
          delete updatedProjects[oldProjectId];
          updatedProjects[projectResult.id] = project;
          projectStore.projects = updatedProjects;

          return true; // AI : Indicates project ID changed
        }

        // AI : For newly created projects, add to contributions optimistically
        if (!projectResult.exists) {
          // AI : Update status locally to match backend
          projectStore.updateProject(project.id, { status: "pending" });
          const updatedProject = projectStore.projects[project.id];
          if (updatedProject) {
            projectStore.addProjectToUserContributions(updatedProject);
          }
        }
      }

      return false; // AI : Project ID didn't change
    } catch (error) {
      const errorMessage = `Failed to publish project "${project.name}" to server: ${error instanceof Error ? error.message : String(error)}`;
      throw new Error(errorMessage, { cause: error });
    }
  }

  // AI : Prepare image for server (upload or extract filename)
  // AI : Images are uploaded to local storage immediately, then migrated to R2 only after moderator approval
  async function prepareImageForServer(overlay: OverlayObject): Promise<string> {
    if (overlay.imageUrl.startsWith("data:")) {
      // AI : Convert data URL to Blob with proper MIME type
      const response = await fetch(overlay.imageUrl);
      const blob = await response.blob();

      // AI : Validate file size before upload (10MB limit matches backend)
      const MAX_FILE_SIZE_MB = 10;
      const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
      if (blob.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(t("upload.fileTooLarge", { maxSize: MAX_FILE_SIZE_MB }));
      }

      // AI : Create a File object with proper name and type
      const file = new File([blob], "overlay-image.webp", { type: blob.type || "image/webp" });

      const formData = new FormData();
      formData.append("image", file);

      // AI : Get API URL based on environment (same logic as tRPC client)
      // AI : Use shared getApiUrl function
      // AI : Upload to server's local storage - will migrate to R2 on approval

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
      // AI : Extract filename from existing server URL
      const urlParts = overlay.imageUrl.split("/");
      const filename = urlParts[urlParts.length - 1];

      if (!filename) {
        throw new Error("Could not extract filename from URL");
      }

      return filename;
    }
  }

  // AI : Synchronize overlay ID change across all stores and references
  function synchronizeOverlayIdChange(
    overlay: OverlayObject,
    oldId: string,
    newId: string,
    project: Project | null,
  ): void {
    // AI : Update overlays store with new key
    const updatedOverlays = { ...overlayStore.overlays };
    delete updatedOverlays[oldId];
    updatedOverlays[newId] = overlay;
    overlayStore.overlays = updatedOverlays;

    // AI : Update marker in allMarkers if it exists
    if (overlayStore.allMarkers[oldId]) {
      const marker = overlayStore.allMarkers[oldId];
      delete overlayStore.allMarkers[oldId];
      overlayStore.allMarkers[newId] = marker;
    }

    // AI : Update project's overlayIds array to use new ID
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

    // AI : Update selected overlay ID if this was the selected one
    if (overlayStore.idSelectedOverlay === oldId) {
      overlayStore.idSelectedOverlay = newId;
    }
  }

  // AI : Handle post-publish UI updates and cache invalidation
  function handlePostPublishUpdates(
    overlay: OverlayObject,
    project: Project | null,
    filename: string,
  ): void {
    // AI : Update marker tooltip to reflect new published state
    updateMarkerTooltip(overlay);

    // AI : Ensure the overlay stays visible on the map after ID change
    if (overlay.overlay && !map.value.hasLayer(overlay.overlay)) {
      overlay.overlay.addTo(map.value);
    }

    // AI : Update cache with new overlay state to refresh marker color (changes from Orange to Yellow)
    // AI : Use robust resolution for cityId as overlay.project might not be fully hydrated
    const cityId = overlay.project?.cityId ?? project?.cityId;

    if (cityId) {
      // AI : Update the overlay in the cache to reflect the new status (yellow/pending instead of orange/modified)
      // AI : This ensures markers at low zoom levels are correct immediately without needing a reload
      addNewOverlayToCityCache(overlay, cityId);

      // AI : Clear standalone cache to ensure project markers are updated correctly (removed if now has overlays)
      mapStore.clearCityStandaloneProjectsCache(cityId);
    }

    // AI : Optimistically add overlay to user contributions (no backend fetch needed)
    // AI : Latest overlays won't show pending submissions, so don't refresh that panel
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

  // AI : Main publish overlay function - orchestrates the publishing workflow
  async function publishOverlay(overlay: OverlayObject, project: Project | null): Promise<void> {
    if (!validateOverlayForPublishing(overlay, project)) {
      return;
    }

    isPublishing.value = true;

    try {
      // AI : Step 1 - Ensure project exists on server first (only for brand new projects)
      // AI : Skip if project is already published (pending/approved) to avoid duplicate publishProject calls
      let projectIdChanged = false;
      if (project?.status === null) {
        projectIdChanged = await ensureProjectOnServer(project);
        if (projectIdChanged) {
          overlay.projectId = project.id;
        }
      }
      // AI : Step 2 - Prepare and upload image if needed
      const filename = await prepareImageForServer(overlay);

      // AI : Step 3 - Publish overlay metadata
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

      // AI : Step 4 - Handle successful publish result
      if (publishResult.id) {
        const oldId = overlay.id;
        const newId = publishResult.id;

        // AI : Update overlay properties with server response
        overlay.id = newId;
        overlay.status = publishResult.status;
        overlay.authorId = publishResult.authorId ?? null;
        overlay.isModified = false;

        // AI : CRITICAL: Update imageUrl to server URL to prevent re-upload on next save
        // AI : Build the server URL from the filename
        // AI : Use /uploads/ path as that's where the backend serves files (there is no /api/images endpoint)
        overlay.imageUrl = `${getApiUrl()}/uploads/${filename}`;
        overlay.filename = filename; // AI : Update filename to the clean one returned by server

        // AI : Synchronize ID change across all stores if ID changed
        if (oldId !== newId) {
          synchronizeOverlayIdChange(overlay, oldId, newId, project);
        }

        // AI : Handle post-publish UI updates and cache invalidation
        handlePostPublishUpdates(overlay, project, filename);
      }

      // AI : Don't refresh city overlays immediately after publishing to avoid overwriting
      // AI : the just-published overlay with stale backend data. The overlay is already
      // AI : updated locally with the correct state and ID from the publish response.
    } catch (error) {
      console.error("Failed to publish overlay:", error);
      throw new Error("Publish Failed: Failed to save to server. Please try again.", {
        cause: error,
      });
    } finally {
      isPublishing.value = false;
    }
  }

  return {
    isPublishing,
    publishOverlay,
  };
}
