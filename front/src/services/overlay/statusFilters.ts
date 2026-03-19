import { ref, computed } from "vue";
import { getOverlayMarkerColor } from "@/services/map/markers";
import { getProjectMarkerColor, getTimelineStatusColor } from "@/utils/markerColors";
import type {
  Project,
  OverlayData,
  OverlayObject,
  viewModeMarkerColor,
  MarkerColor,
} from "@/types/index";
import type { AppMode } from "@shared/types";

// All possible marker colors (includes edit/moderation mode colors)
const ALL_MARKER_COLORS: MarkerColor[] = [
  "yellow",
  "green",
  "orange",
  "grey",
  "blue",
  "red",
  "purple",
];

// Selected status filters. Empty selection means "show all statuses" (same behavior as tags).
// Colors map to timeline statuses in view mode:
//   yellow = proposed, blue = planned, orange = under_construction, green = completed, grey = canceled
export const selectedStatusFilters = ref<viewModeMarkerColor[]>([]);

// Computed visibility states for backwards compatibility
// When selection is empty, all are visible. Otherwise, only selected are visible.
// Uses MarkerColor internally to cover edit/moderation mode colors too.
export const visibleStates = computed(() => {
  const states: Record<MarkerColor, boolean> = {
    yellow: false,
    green: false,
    orange: false,
    grey: false,
    blue: false,
    red: false,
    purple: false,
  };

  if (selectedStatusFilters.value.length === 0) {
    // Empty selection = show all
    for (const color of ALL_MARKER_COLORS) {
      states[color] = true;
    }
  } else {
    // Only show selected (view mode colors)
    for (const color of selectedStatusFilters.value) {
      states[color] = true;
    }
    // In edit/moderation modes, always show red and purple (user's own content)
    states.red = true;
    states.purple = true;
  }

  return states;
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
 * Check whether tags match the currently selected tag filters.
 * Exported for use by cluster filtering.
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
 * Filter GeoJSON FeatureCollection based on current tag and status filters.
 * Used by the cluster source to filter project points.
 */
export function filterGeoJsonByTags(geojson: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const filteredFeatures = geojson.features.filter((feature) => {
    const props = feature.properties ?? {};
    const tags = Array.isArray(props.tags) ? (props.tags as string[]) : null;
    const timelineStatus = props.timelineStatus;

    // Filter by tag
    const tagMatch = matchesSelectedTags(tags);

    // Filter by status (view mode logic)
    // Note: GeoJSON is only used in view mode for clusters, so we map timelineStatus to marker colors
    let statusMatch = true;
    if (timelineStatus) {
      const color = getTimelineStatusColor(timelineStatus);
      statusMatch = visibleStates.value[color];
    } else {
      // Default color logic if timelineStatus is somehow missing
      statusMatch = visibleStates.value.yellow;
    }

    return tagMatch && statusMatch;
  });

  return {
    ...geojson,
    features: filteredFeatures,
  };
}

/**
 * Shared visibility check for standalone project markers.
 */
export function shouldShowStandaloneProject(project: Project, mode: AppMode): boolean {
  const markerColor = getProjectMarkerColor(project, mode);
  return visibleStates.value[markerColor] && matchesSelectedTags(project.tags);
}

/**
 * Toggle a specific status filter. Empty selection means all statuses are visible.
 */
export function toggleFilter(color: viewModeMarkerColor): void {
  if (selectedStatusFilters.value.includes(color)) {
    selectedStatusFilters.value = selectedStatusFilters.value.filter((c) => c !== color);
    return;
  }

  selectedStatusFilters.value = [...selectedStatusFilters.value, color];
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
  return visibleStates.value[statusColor];
}
