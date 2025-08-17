import { ref } from 'vue';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';

// AI : Global completion status filter state
const visibleCompletionStates = ref({
  green: true,   // Not started
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
    filterByCompletionStatus(overlays: any[]) {
      return overlays.filter(overlay => {
        const completionColor = getOverlayMarkerColor(overlay, 'view');
        return visibleCompletionStates.value[completionColor as keyof typeof visibleCompletionStates.value];
      });
    },
    
    /**
     * AI : Toggle a specific completion status filter
     */
    toggleFilter(status: 'green' | 'orange' | 'grey') {
      visibleCompletionStates.value[status] = !visibleCompletionStates.value[status];
    },
    
    /**
     * AI : Check if a specific overlay should be visible based on current filters
     */
    shouldShowOverlay(overlay: any) {
      const completionColor = getOverlayMarkerColor(overlay, 'view');
      return visibleCompletionStates.value[completionColor as keyof typeof visibleCompletionStates.value];
    }
  };
}