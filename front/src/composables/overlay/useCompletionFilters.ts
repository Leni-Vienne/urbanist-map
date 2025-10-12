import { ref } from 'vue';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import type { OverlayData, OverlayObject, viewModeMarkerColor } from '@types';

// AI : Global completion status filter state
const visibleCompletionStates = ref({
  yellow: true,  // Proposed
  green: true,   // Planned
  orange: true,  // In progress
  grey: true     // Completed
});

/**
 * AI : Get current completion filter states
 */
export function useCompletionFilters() {
  return {
    visibleCompletionStates,

    /**
     * AI : Filter overlays array based on current completion status filters
     * AI : In view mode, also filters out pending overlays (only show approved)
     */
    filterByCompletionStatus<T extends OverlayObject | OverlayData>(overlays: T[]): T[] {
      const overlayStore = useOverlayStore();

      return overlays.filter((overlay) => {
        // AI : In view mode, hide pending overlays (they should only be visible in edit mode)
        if (!overlayStore.isEditMode && overlay.status === 'pending') {
          return false;
        }

        const completionColor = getOverlayMarkerColor(overlay, 'view');
        return visibleCompletionStates.value[completionColor as keyof typeof visibleCompletionStates.value];
      });
    },

    /**
     * AI : Toggle a specific completion status filter
     */
    toggleFilter(color: viewModeMarkerColor) {
      visibleCompletionStates.value[color] = !visibleCompletionStates.value[color];
    },

    /**
     * AI : Check if a specific overlay should be visible based on current filters
     * AI : In view mode, also checks that overlay is not pending
     */
    shouldShowOverlay(overlay: OverlayObject | OverlayData) {
      const overlayStore = useOverlayStore();

      // AI : In view mode, hide pending overlays (they should only be visible in edit mode)
      if (!overlayStore.isEditMode && overlay.status === 'pending') {
        return false;
      }

      const completionColor = getOverlayMarkerColor(overlay, 'view');
      return visibleCompletionStates.value[completionColor as keyof typeof visibleCompletionStates.value];
    }
  };
}
