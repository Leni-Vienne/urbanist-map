import { storeToRefs } from 'pinia';
import { useMapStore } from '@stores/pinia/mapStore';
import { useFieldChanges } from '@composables/changes/useFieldChanges';
import { updateMarkerTooltip } from '@composables/overlay/useOverlay'
import type { OverlayObject } from '@types';

export function useApprovedOverlayChanges() {
  const mapStore = useMapStore();
  const { currentCityOverlays } = storeToRefs(mapStore);
  const { submitMultipleFieldChanges } = useFieldChanges();

  // AI : Submit change request for approved overlay modifications
  async function submitApprovedOverlayChanges(overlay: OverlayObject): Promise<void> {
    // AI : Find the original overlay data from currentCityOverlays (backend-approved data)
    const originalOverlay = currentCityOverlays.value.find(o => o.id === overlay.id);
    if (!originalOverlay) {
      throw new Error('Original overlay data not found');
    }

    // AI : Detect which fields have changed
    const changes = [];

    if (overlay.projectId !== originalOverlay.projectId) {
      changes.push({
        fieldName: 'projectId',
        oldValue: originalOverlay.projectId,
        newValue: overlay.projectId,
        changeReason: 'User changed the parent project'
      });
    }

    if (overlay.caption !== originalOverlay.caption) {
      changes.push({
        fieldName: 'caption',
        oldValue: originalOverlay.caption ?? null,
        newValue: overlay.caption,
        changeReason: 'User modified the overlay caption'
      });
    }

    // AI : Get current corners from Leaflet overlay if available, otherwise use stored corners
    const currentCorners = overlay.overlay
      ? overlay.overlay.getCorners().map(c => ({ lat: c.lat, lng: c.lng }))
      : overlay.corners;

    // AI : Normalize both corner arrays to plain objects for comparison
    const normalizedCurrentCorners = currentCorners.map(c => ({ lat: c.lat, lng: c.lng }));
    const normalizedOriginalCorners = originalOverlay.corners.map(c => ({ lat: c.lat, lng: c.lng }));

    if (JSON.stringify(normalizedCurrentCorners) !== JSON.stringify(normalizedOriginalCorners)) {
      changes.push({
        fieldName: 'corners',
        oldValue: normalizedOriginalCorners,
        newValue: normalizedCurrentCorners,
        changeReason: 'User moved, rotated, or scaled the overlay'
      });
    }

    if (changes.length === 0) {
      throw new Error('No changes detected for approved overlay');
    }

    await submitMultipleFieldChanges('overlay', overlay.id, changes);

    // AI : Reset modified flag after successfully submitting change request
    overlay.isModified = false;
    updateMarkerTooltip(overlay);
  }

  return {
    submitApprovedOverlayChanges
  };
}
