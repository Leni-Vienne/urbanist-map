import { ref } from "vue";
import { getOverlayMarkerColor } from "@/services/map/markers";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import type { OverlayData, OverlayObject, viewModeMarkerColor } from "@/types/index";

// AI : Global completion status filter state
// AI : Includes all colors that can be returned by getOverlayMarkerColor for any mode
const visibleCompletionStates = ref({
  yellow: true, // Proposed (view mode) / Pending approval & submitted change requests (edit mode) / Approved with changes (moderation mode)
  green: true, // Planned (view mode) / Approved without pending changes (edit/moderation mode)
  orange: true, // In progress (view mode) / Modified locally (edit mode)
  grey: true, // Completed (view mode)
  blue: true, // Pending (moderation mode)
  red: true, // Rejected or new overlay (edit mode)
  purple: true, // Local replacement overlays before submission (edit mode)
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
        // AI : In view mode only, hide pending overlays (they are visible in edit and moderation modes)
        if (overlayStore.mode === "view" && overlay.status === "pending") {
          return false;
        }

        const completionColor = getOverlayMarkerColor(overlay, overlayStore.mode);
        return visibleCompletionStates.value[
          completionColor as keyof typeof visibleCompletionStates.value
        ];
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
     * AI : In view mode only, also checks that overlay is not pending
     */
    shouldShowOverlay(overlay: OverlayObject | OverlayData) {
      const overlayStore = useOverlayStore();

      // AI : In view mode only, hide pending overlays (they are visible in edit and moderation modes)
      if (overlayStore.mode === "view" && overlay.status === "pending") {
        return false;
      }

      const completionColor = getOverlayMarkerColor(overlay, overlayStore.mode);
      return visibleCompletionStates.value[
        completionColor as keyof typeof visibleCompletionStates.value
      ];
    },
  };
}
