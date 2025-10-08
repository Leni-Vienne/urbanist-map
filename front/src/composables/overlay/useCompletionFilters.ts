import { ref } from 'vue';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
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
     */
    filterByCompletionStatus<T extends OverlayObject | OverlayData>(overlays: T[]): T[] {
      return overlays.filter((overlay) => {
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
     */
    shouldShowOverlay(overlay: OverlayObject | OverlayData) {
      const completionColor = getOverlayMarkerColor(overlay, 'view');
      return visibleCompletionStates.value[completionColor as keyof typeof visibleCompletionStates.value];
    }
  };
}
