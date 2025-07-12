// AI : Simplified edit mode management
import { clearAllOverlays } from '@composables/overlay/useOverlay';
import { isEditMode } from '@stores/overlayStore';

/**
 * AI : Toggle between edit and view modes
 */
export async function toggleEditMode(): Promise<void> {
  isEditMode.value = !isEditMode.value;

  // AI : Clear current overlays when switching modes
  clearAllOverlays();

  if (isEditMode.value) {
    // AI : In edit mode, start with empty state (overlays are added when uploaded)
    console.log('AI : Switched to edit mode');
  } else {
    // AI : In view mode, overlays will be loaded by the view mode system
    console.log('AI : Switched to view mode');
  }
}

/**
 * AI : Set edit mode state without toggling
 */
export function setEditMode(editMode: boolean): void {
  isEditMode.value = editMode;
}

// AI : Re-export isEditMode for convenience
export { isEditMode };
