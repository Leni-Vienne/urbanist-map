import { ref } from "vue";
import { getOverlayMarkerColor } from "@/services/map/markers";
import type { OverlayData, OverlayObject, viewModeMarkerColor } from "@/types/index";
import { AppMode } from "@shared/types";

// AI : ============================================================================
// AI : COMPLETION FILTERS SERVICE - Global completion status filter state
// AI : ============================================================================

// AI : Global completion status filter state
// AI : Includes all colors that can be returned by getOverlayMarkerColor for any mode
export const visibleCompletionStates = ref({
  yellow: true, // Proposed (view mode) / Pending approval & submitted change requests (edit mode) / Approved with changes (moderation mode)
  green: true, // Planned (view mode) / Approved without pending changes (edit/moderation mode)
  orange: true, // In progress (view mode) / Modified locally (edit mode)
  grey: true, // Completed (view mode)
  blue: true, // Pending (moderation mode)
  red: true, // Rejected or new overlay (edit mode)
  purple: true, // Local replacement overlays before submission (edit mode)
});

/**
 * AI : Filter overlays array based on current completion status filters
 * AI : In view mode, also filters out pending overlays (only show approved)
 */
export function filterByCompletionStatus<T extends OverlayObject | OverlayData>(
  overlays: T[],
  mode: AppMode,
): T[] {
  return overlays.filter((overlay) => shouldShowOverlay(overlay, mode));
}

/**
 * AI : Toggle a specific completion status filter
 */
export function toggleFilter(color: viewModeMarkerColor) {
  visibleCompletionStates.value[color] = !visibleCompletionStates.value[color];
}

/**
 * AI : Check if a specific overlay should be visible based on current filters
 * AI : In view mode only, also checks that overlay is not pending
 */
function shouldShowOverlay(overlay: OverlayObject | OverlayData, mode: AppMode) {
  // AI : In view mode only, hide pending overlays (they are visible in edit and moderation modes)
  if (mode === "view" && overlay.status === "pending") {
    return false;
  }

  const completionColor = getOverlayMarkerColor(overlay, mode);
  return visibleCompletionStates.value[
    completionColor as keyof typeof visibleCompletionStates.value
  ];
}
