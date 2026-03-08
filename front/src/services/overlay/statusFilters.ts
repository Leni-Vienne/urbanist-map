import { ref } from "vue";
import { getOverlayMarkerColor } from "@/services/map/markers";
import type { OverlayData, OverlayObject, viewModeMarkerColor } from "@/types/index";
import type { AppMode } from "@shared/types";

// Includes all colors that can be returned by getOverlayMarkerColor for any mode
export const visibleStates = ref({
  yellow: true, // Proposed (view mode) / Pending approval & submitted change requests (edit mode) / Approved with changes (moderation mode)
  green: true, // Completed (view mode) / Approved without pending changes (edit/moderation mode)
  orange: true, // In progress (view mode) / Modified locally (edit mode)
  grey: true, // Unused in view mode
  blue: true, // Upcoming/planned (view mode) / Pending (moderation mode)
  red: true, // Rejected or new overlay (edit mode)
  purple: true, // Local replacement overlays before submission (edit mode)
});

/**
 * Filter overlays array based on current status filters
 * In view mode, also filters out pending overlays (only show approved)
 */
export function filterByStatus<T extends OverlayObject | OverlayData>(
  overlays: T[],
  mode: AppMode,
): T[] {
  return overlays.filter((overlay) => shouldShowOverlay(overlay, mode));
}

/**
 * Toggle a specific status filter
 */
export function toggleFilter(color: viewModeMarkerColor) {
  visibleStates.value[color] = !visibleStates.value[color];
}

/**
 * Check if a specific overlay should be visible based on current filters
 * In view mode only, also checks that overlay is not pending
 */
function shouldShowOverlay(overlay: OverlayObject | OverlayData, mode: AppMode) {
  // In view mode only, hide pending overlays (they are visible in edit and moderation modes)
  if (mode === "view" && overlay.status === "pending") {
    return false;
  }

  const statusColor = getOverlayMarkerColor(overlay, mode);
  return visibleStates.value[statusColor as keyof typeof visibleStates.value];
}
