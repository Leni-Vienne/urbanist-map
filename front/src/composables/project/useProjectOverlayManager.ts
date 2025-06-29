import { ref, computed, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { 
  addOverlayToProjectWithId, 
  removeOverlayFromProjectWithId 
} from '@composables/project/useProjects';
import { overlays } from '@composables/overlay/useOverlay';
import { navigateToOverlay } from '@composables/overlay/useOverlayActions';
import { useToast } from '@composables/ui/useToast';

// AI : Composable for managing project overlay operations and dialog
export function useProjectOverlayManager(projectId: string, onOverlaysChanged: () => void) {
  const router = useRouter();
  const toast = useToast();
  
  const showAddOverlayDialog = ref(false);

  // AI : Get available overlays that can be added to the project
  const availableOverlays = computed(() =>
    Object.values(overlays.value).filter(overlay =>
      !overlay.projectId || overlay.projectId !== projectId
    )
  );

  // AI : Add overlay to project
  const addOverlayToProject = async (overlayId: string) => {
    if (!projectId) return;

    try {
      await addOverlayToProjectWithId(projectId, overlayId);
      onOverlaysChanged();
      showAddOverlayDialog.value = false;
        toast.add({
        severity: 'success',
        summary: 'Overlay Added',
        detail: 'Overlay successfully added to project',
        life: 3000
      });
    } catch (error) {
      console.error('Failed to add overlay to project:', error);
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to add overlay to project',
        life: 3000
      });
    }
  };

  // AI : Remove overlay from project
  const removeOverlayFromProject = async (overlayId: string) => {
    if (!projectId) return;

    try {
      await removeOverlayFromProjectWithId(projectId, overlayId);
      onOverlaysChanged();
        toast.add({
        severity: 'success',
        summary: 'Overlay Removed',
        detail: 'Overlay successfully removed from project',
        life: 3000
      });
    } catch (error) {
      console.error('Failed to remove overlay from project:', error);
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to remove overlay from project',
        life: 3000
      });
    }
  };

  // AI : Navigate to overlay on map
  const viewOverlay = async (overlayId: string) => {
    const overlay = overlays.value[overlayId];
    if (!overlay) return;
    router.push('/');
    // AI : Use nextTick for more reliable timing than arbitrary timeout
    nextTick(() => {
      if (navigateToOverlay(overlayId)) {
        toast.add({
          severity: 'info',
          summary: 'Viewing Overlay',
          detail: `Navigated to ${overlay.caption || 'Unnamed Overlay'}`,
          life: 3000
        });
      }
    });
  };

  return {
    showAddOverlayDialog,
    availableOverlays,
    addOverlayToProject,
    removeOverlayFromProject,
    viewOverlay
  };
}
