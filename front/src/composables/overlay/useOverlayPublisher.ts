import { ref } from 'vue';
import { useToast } from '@composables/ui/useToast';
import { useProjectStore } from '@stores/pinia/projectStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { allMarkers, updateMarkerTooltip } from '@composables/overlay/useOverlay';
import { map } from '@composables/core/useMap';
import { trpc, getApiUrl } from '@client';
import { storeToRefs } from 'pinia';
import type { OverlayObject, Project } from '@types';

export function useOverlayPublisher() {
  const isPublishing = ref(false);
  const toast = useToast();
  const projectStore = useProjectStore();
  const overlayStore = useOverlayStore();
  const { projects } = storeToRefs(projectStore);
  const { overlays, idSelectedOverlay } = storeToRefs(overlayStore);

  function getCornersFromOverlay(overlay: OverlayObject) {
    if (overlay.overlay) {
      return overlay.overlay.getCorners();
    }
    return [
      { lat: overlay.topLeftLat, lng: overlay.topLeftLng },
      { lat: overlay.topRightLat, lng: overlay.topRightLng },
      { lat: overlay.bottomRightLat, lng: overlay.bottomRightLng },
      { lat: overlay.bottomLeftLat, lng: overlay.bottomLeftLng },
    ];
  }

  // AI : Validate if overlay can be published
  function validateOverlayForPublishing(overlay: OverlayObject, project: Project | null): boolean {
    if (!project) {
      toast.add({
        severity: 'error',
        summary: 'Cannot Publish',
        detail: 'Overlay must be assigned to a project',
        life: 3000
      });
      return false;
    }

    const corners = getCornersFromOverlay(overlay);
    if (!corners || corners.length !== 4 || corners.some(c => !c.lat || !c.lng)) {
      toast.add({
        severity: 'error',
        summary: 'Cannot Publish',
        detail: 'Overlay must have valid position (4 corners)',
        life: 3000
      });
      return false;
    }
    return true;
  }

  // AI : Ensure project exists on server and handle project publishing
  async function ensureProjectOnServer(project: Project): Promise<boolean> {
    try {
      const projectResult = await trpc.project.publishProject.mutate({
        id: project.id,
        name: project.name,
        description: project.description ?? undefined,
        cityId: project.cityId ?? undefined,
        startDate: project.startDate?.toISOString(),
        endDate: project.endDate?.toISOString(),
        sourceUrl: project.sourceUrl ?? undefined,
        latestUpdateOn: project.latestUpdateOn?.toISOString()
      });

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

      // AI : Show appropriate message
      const actionText = projectResult.exists ? 'updated on' : 'saved to';
      if (!projectResult.exists) {
        toast.add({
          severity: 'info',
          summary: 'Project Published',
          detail: `Project has been ${actionText} the server database`,
          life: 2000
        });
      }
      return false; // AI : Project ID didn't change
    } catch (error) {
      toast.add({
        severity: 'error',
        summary: 'Project Publish Failed',
        detail: `Failed to publish project "${project.name}" to server: ${error instanceof Error ? error.message : String(error)}`,
        life: 5000
      });
      throw error;
    }
  }

  // AI : Prepare image for server (upload or extract filename)
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

      const uploadResponse = await fetch(`${getApiUrl()}/api/upload-image`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image to server');
      }
      const uploadResult = await uploadResponse.json() as { filename: string };

      return uploadResult.filename;
    } else {
      // AI : Extract filename from existing server URL
      const urlParts = overlay.imageUrl.split('/');
      return urlParts[urlParts.length - 1];
    }
  }

  // AI : Publish overlay metadata to server
  async function publishOverlayToServer(overlay: OverlayObject, filename: string): Promise<{ success: boolean; exists: boolean; id?: string }> {
    const corners = getCornersFromOverlay(overlay);
    const payload = {
      id: overlay.id,
      filename: filename,
      caption: overlay.caption ?? undefined,
      projectId: overlay.projectId!,
      replacesOverlayId: overlay.replacesOverlayId ?? undefined,
      metadata: {
        // AI : Keep metadata empty as requested - no caption or history data
      },
      corners: corners.map(c => ({ lat: c.lat, lng: c.lng })),
    };

    const overlayResult = await trpc.overlay.publishOverlay.mutate(payload);

    if (overlayResult.success) {
      const actionText = overlayResult.exists ? 'updated on' : 'saved to';
      const summaryText = overlay.replacesOverlayId ? 'Replacement Submitted' : 'Overlay Published';
      const detailText = overlay.replacesOverlayId
        ? 'Replacement overlay has been submitted for moderation review'
        : `Overlay has been ${actionText} the server database`;

      toast.add({
        severity: 'success',
        summary: summaryText,
        detail: detailText,
        life: 3000
      });
      return { success: true, exists: overlayResult.exists, id: overlayResult.id };
    }

    return { success: false, exists: false };
  }

  // AI : Main publish overlay function
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
        // AI : If project ID changed, update overlay's project reference
        if (projectIdChanged) {
          overlay.projectId = project.id;
        }
      }

      // AI : Step 2 - Prepare and upload image if needed
      const filename = await prepareImageForServer(overlay);

      // AI : Step 3 - Publish overlay metadata
      const publishResult = await publishOverlayToServer(overlay, filename);

      // AI : If publishing was successful, update overlay ID and update store
      if (publishResult.success && publishResult.id) {
        const oldId = overlay.id;
        const newId = publishResult.id;

        // AI : Update overlay ID and reset modified flag since it's now saved
        overlay.id = newId;
        overlay.isModified = false;
        // AI : Mark overlay as saved to backend (this affects marker color)
        overlay.savedRemotely = true;

        // AI : If ID changed, update the overlays store with new key
        if (oldId !== newId) {
          console.log(`AI: Publishing changed overlay ID from ${oldId} to ${newId}`);
          const updatedOverlays = { ...overlays.value };
          delete updatedOverlays[oldId]; // Remove old entry
          updatedOverlays[newId] = overlay; // Add with new ID
          overlays.value = updatedOverlays;

          // AI : Also update marker in allMarkers if it exists
          if (allMarkers.value[oldId]) {
            const marker = allMarkers.value[oldId];
            delete allMarkers.value[oldId];
            allMarkers.value[newId] = marker;
            console.log(`AI: Updated marker ID from ${oldId} to ${newId}`);
          }

          // AI : Update project's overlayIds array to use new ID
          if (project?.id) {
            const updatedProjects = { ...projects.value };
            const projectToUpdate = { ...updatedProjects[project.id] };

            // Replace old overlay ID with new ID in the project's overlayIds array
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

        // AI : Update marker tooltip to reflect new published state (green color)
        updateMarkerTooltip(overlay);

        // AI : Ensure the overlay stays visible on the map after ID change
        if (overlay.overlay && map.value && !map.value.hasLayer(overlay.overlay)) {
          console.log(`AI: Re-adding overlay ${newId} to map after publishing`);
          overlay.overlay.addTo(map.value);
        }
      }

      // AI : Don't refresh city overlays immediately after publishing to avoid overwriting
      // AI : the just-published overlay with stale backend data. The overlay is already
      // AI : updated locally with the correct state and ID from the publish response.
    } catch (error) {
      console.error('AI : Failed to publish overlay:', error);
      toast.add({
        severity: 'error',
        summary: 'Publish Failed',
        detail: 'Failed to save to server. Please try again.',
        life: 3000
      });
    } finally {
      isPublishing.value = false;
    }
  }

  return {
    isPublishing,
    publishOverlay
  };
}