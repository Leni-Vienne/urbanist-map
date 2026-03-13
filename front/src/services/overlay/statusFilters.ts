import { ref } from "vue";
import { getOverlayMarkerColor } from "@/services/map/markers";
import { getProjectMarkerColor } from "@/utils/markerColors";
import type { Project, OverlayData, OverlayObject, viewModeMarkerColor } from "@/types/index";
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

// Empty selection means "show all tags"
export const selectedProjectTags = ref<string[]>([]);
export const UNTAGGED_PROJECT_FILTER = "__untagged__";

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
 * Toggle a project tag filter. Empty selection means all tags are visible.
 */
export function toggleProjectTagFilter(tag: string): void {
  if (selectedProjectTags.value.includes(tag)) {
    selectedProjectTags.value = selectedProjectTags.value.filter((t) => t !== tag);
    return;
  }

  selectedProjectTags.value = [...selectedProjectTags.value, tag];
}

/**
 * Check whether a project matches the currently selected tag filters.
 */
function matchesSelectedTags(tags: string[] | null | undefined): boolean {
  if (selectedProjectTags.value.length === 0) return true;

  const includeUntagged = selectedProjectTags.value.includes(UNTAGGED_PROJECT_FILTER);
  const selectedKnownTags = selectedProjectTags.value.filter(
    (tag) => tag !== UNTAGGED_PROJECT_FILTER,
  );

  if (!tags || tags.length === 0) {
    return includeUntagged;
  }

  if (selectedKnownTags.length === 0) {
    return false;
  }

  return tags.some((tag) => selectedKnownTags.includes(tag));
}

/**
 * Shared visibility check for standalone project markers.
 */
export function shouldShowStandaloneProject(project: Project, mode: AppMode): boolean {
  const markerColor = getProjectMarkerColor(project, mode);
  return visibleStates.value[markerColor] && matchesSelectedTags(project.tags);
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

  if (!matchesSelectedTags(overlay.project?.tags)) {
    return false;
  }

  const statusColor = getOverlayMarkerColor(overlay, mode);
  return visibleStates.value[statusColor as keyof typeof visibleStates.value];
}
