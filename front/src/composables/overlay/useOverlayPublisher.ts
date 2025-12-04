import { ref } from 'vue';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useMapStore } from '@stores/pinia/mapStore';
import { updateMarkerTooltip } from '@composables/overlay/useOverlay';
import { map } from '@composables/core/useMap';
import { trpc, getApiUrl } from '@client';
import { storeToRefs } from 'pinia';
import { buildProjectPayload } from '@composables/project/useProjectMutations';
import type { OverlayObject, Project } from '@types';
import { validateOverlaySize, leafletCornersToCorners } from '../../../../back/src/shared/validation';
import { useI18n } from 'vue-i18n';
import { ApprovalStatus } from '../../../../back/src/shared/types';

// AI : Extract corners from overlay object, falling back to stored corners if needed
function getCornersFromOverlay(overlay: OverlayObject) {
  if (overlay.overlay) {
    return overlay.overlay.getCorners();
  }
  console.log("Corners undefined, using stored corners");
  return overlay.corners;
}

export function useOverlayPublisher() {
  const isPublishing = ref(false);
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const { projects } = storeToRefs(projectStore);
  const { overlays, idSelectedOverlay } = storeToRefs(overlayStore);
  const { t } = useI18n();

  // AI : Validate if overlay can be published
  function validateOverlayForPublishing(overlay: OverlayObject, project: Project | null): boolean {
    if (!project) {
      throw new Error('Cannot Publish: Overlay must be assigned to a project');
    }

    const corners = getCornersFromOverlay(overlay);
    if (!corners || corners.length !== 4 || corners.some(c => !c.lat || !c.lng)) {
      throw new Error('Cannot Publish: Overlay must have valid position (4 corners)');
    }

    // AI : Validate overlay size constraints
    const cornersArray = leafletCornersToCorners(corners);
    const sizeValidation = validateOverlaySize(cornersArray);
    
    if (!sizeValidation.isValid) {
      // AI : Simple i18n error message
      throw new Error(t('overlay.overlayTooLarge'));
    }

    return true;
  }

  // AI : Ensure project exists on server and handle project publishing
  async function ensureProjectOnServer(project: Project): Promise<boolean> {
    try {
      // AI : For approved projects, skip publishing - they already exist on server
      // AI : Project modifications will be handled separately via change request flow
      if (project.status === 'approved') {
        return false; // AI : Project ID won't change for existing approved projects
      }

      // AI : Use shared helper to build consistent payload
      const projectResult = await trpc.project.publishProject.mutate(
        buildProjectPayload(project)
      );

      if (!projectResult.success) {
        throw new Error('Failed to publish project to server');
      }

      // AI : Handle project ID update and IndexedDB cleanup if this is a new project
      if (projectResult.success && projectResult.id) {
        const oldProjectId = project.id;

        // AI : If this is a new project (not existing), update the project ID
        if (!projectResult.exists && projectResult.id !== oldProjectId) {
          // AI : Update the project ID with the one from the backend
          project.id = projectResult.id;

          // AI : Update project ID in the projects store
          const updatedProjects = { ...projects.value };
          delete updatedProjects[oldProjectId];
          updatedProjects[projectResult.id] = project;
          projects.value = updatedProjects;

          return true; // AI : Indicates project ID changed
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
    if (overlay.imageUrl.startsWith('data:')) {
      // AI : Convert data URL to Blob with proper MIME type
      const response = await fetch(overlay.imageUrl);
      const blob = await response.blob();
      
      // AI : Create a File object with proper name and type
      const file = new File([blob], 'overlay-image.webp', { type: blob.type || 'image/webp' });
      
      const formData = new FormData();
      formData.append('image', file);

      // AI : Get API URL based on environment (same logic as tRPC client)
      // AI : Use shared getApiUrl function
      // AI : Upload to server's local storage - will migrate to R2 on approval

      const uploadResponse = await fetch(`${getApiUrl()}/api/upload-image`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image to server');
      }
      const uploadResult: { filename: string } = await uploadResponse.json();

      return uploadResult.filename;
    } else {
      // AI : Extract filename from existing server URL
      const urlParts = overlay.imageUrl.split('/');
      return urlParts[urlParts.length - 1];
    }
  }

  // AI : Publish overlay metadata to server
  async function publishOverlayToServer(overlay: OverlayObject, filename: string): Promise<{ success: boolean; exists: boolean; id?: string; status?: string; authorId?: string | null }> {
    const corners = getCornersFromOverlay(overlay);
    const payload = {
      id: overlay.id,
      filename: filename,
      caption: overlay.caption ?? undefined,
      projectId: overlay.projectId!,
      replacesOverlayId: overlay.replacesOverlayId ?? undefined,
      corners: corners.map(c => ({ lat: c.lat, lng: c.lng })),
    };

    const overlayResult = await trpc.overlay.publishOverlay.mutate(payload);

    if (overlayResult.success) {
      return {
        success: true,
        exists: overlayResult.exists,
        id: overlayResult.id,
        status: overlayResult.status,
        authorId: overlayResult.authorId
      };
    }

    return { success: false, exists: false };
  }

  // AI : Synchronize overlay ID change across all stores and references
  function synchronizeOverlayIdChange(
    overlay: OverlayObject,
    oldId: string,
    newId: string,
    project: Project | null
  ): void {
    console.log(`AI: Publishing changed overlay ID from ${oldId} to ${newId}`);
    
    // AI : Update overlays store with new key
    const updatedOverlays = { ...overlays.value };
    delete updatedOverlays[oldId];
    updatedOverlays[newId] = overlay;
    overlays.value = updatedOverlays;

    // AI : Update marker in allMarkers if it exists
    if (overlayStore.allMarkers[oldId]) {
      const marker = overlayStore.allMarkers[oldId];
      delete overlayStore.allMarkers[oldId];
      overlayStore.allMarkers[newId] = marker;
      console.log(`AI: Updated marker ID from ${oldId} to ${newId}`);
    }

    // AI : Update project's overlayIds array to use new ID
    if (project?.id) {
      const updatedProjects = { ...projects.value };
      const projectToUpdate = { ...updatedProjects[project.id] };
      const overlayIndex = projectToUpdate.overlayIds.indexOf(oldId);
      
      if (overlayIndex !== -1) {
        projectToUpdate.overlayIds = [...projectToUpdate.overlayIds];
        projectToUpdate.overlayIds[overlayIndex] = newId;
        updatedProjects[project.id] = projectToUpdate;
        projects.value = updatedProjects;
      }
    }

    // AI : Update selected overlay ID if this was the selected one
    if (idSelectedOverlay.value === oldId) {
      idSelectedOverlay.value = newId;
    }
  }

  // AI : Handle post-publish UI updates and cache invalidation
  function handlePostPublishUpdates(overlay: OverlayObject, project: Project | null, filename: string): void {
    // AI : Update marker tooltip to reflect new published state
    updateMarkerTooltip(overlay);

    // AI : Ensure the overlay stays visible on the map after ID change
    if (overlay.overlay && map.value && !map.value.hasLayer(overlay.overlay)) {
      console.log(`AI: Re-adding overlay ${overlay.id} to map after publishing`);
      overlay.overlay.addTo(map.value);
    }

    // AI : Invalidate all mode caches for this city after successful publish
    // AI : This ensures fresh data on next mode switch without overwriting current local state
    const cityId = overlay.project?.cityId;
    if (cityId) {
      mapStore.clearCityProjectsCache(cityId);
      mapStore.clearCityStandaloneProjectsCache(cityId);
    }

    // AI : Optimistically add overlay to user contributions (no backend fetch needed)
    // AI : Latest overlays won't show pending submissions, so don't refresh that panel
    if (project) {
      projectStore.addOverlayToUserContributions(overlay, project, filename);
    }
  }

  // AI : Main publish overlay function - orchestrates the publishing workflow
  async function publishOverlay(overlay: OverlayObject, project: Project | null): Promise<void> {
    if (!validateOverlayForPublishing(overlay, project)) {
      return;
    }

    isPublishing.value = true;

    try {
      // AI : Step 1 - Ensure project exists on server first
      let projectIdChanged = false;
      if (project) {
        projectIdChanged = await ensureProjectOnServer(project);
        if (projectIdChanged) {
          overlay.projectId = project.id;
        }
      }

      // AI : Step 2 - Prepare and upload image if needed
      const filename = await prepareImageForServer(overlay);

      // AI : Step 3 - Publish overlay metadata
      const publishResult = await publishOverlayToServer(overlay, filename);

      // AI : Step 4 - Handle successful publish result
      if (publishResult.success && publishResult.id) {
        const oldId = overlay.id;
        const newId = publishResult.id;

        // AI : Update overlay properties with server response
        overlay.id = newId;
        overlay.status = publishResult.status as ApprovalStatus;
        overlay.authorId = publishResult.authorId ?? null;
        overlay.isModified = false;

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
      console.error('Failed to publish overlay:', error);
      throw new Error('Publish Failed: Failed to save to server. Please try again.', { cause: error });
    } finally {
      isPublishing.value = false;
    }
  }

  return {
    isPublishing,
    publishOverlay
  };
}
