// AI : Simplified edit mode management
import { ref } from 'vue';
import { overlays } from '@stores/overlayStore';
import { initializeOverlays } from '@composables/overlay/useOverlay';
import { map } from '@composables/core/useMap';

export const isEditMode = ref<boolean>(false);

/**
 * AI : Toggle between edit and view modes
 */
export async function toggleEditMode(): Promise<void> {
  isEditMode.value = !isEditMode.value;
  
  // AI : Clear current overlays when switching modes
  Object.values(overlays.value).forEach(overlay => {
    if (overlay.overlay && map.value) {
      map.value.removeLayer(overlay.overlay);
    }
    if (overlay.marker && map.value) {
      map.value.removeLayer(overlay.marker);
    }
  });
  
  // AI : Clear overlays store
  Object.keys(overlays.value).forEach(key => {
    delete overlays.value[key];
  });
  
  if (isEditMode.value) {
    // AI : In edit mode, start with empty state (overlays are added when uploaded)
    console.log('AI : Switched to edit mode');
  }
  
  await initializeOverlays();
}

/**
 * AI : Set edit mode state without toggling
 */
export function setEditMode(editMode: boolean): void {
  isEditMode.value = editMode;
}
