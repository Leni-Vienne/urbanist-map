import { ref, computed } from "vue";
import { getProjectMarkerColor } from "@/utils/markerColors";
import type { Project, OverlayData, OverlayObject } from "@/types/index";
import type { AppMode } from "@shared/types";
import type { TimelineStatus } from "../../../../back/src/db/schema";

// All timeline statuses used in the filter
const ALL_TIMELINE_STATUSES: TimelineStatus[] = [
  "proposed",
  "planned",
  "under_construction",
  "completed",
  "canceled",
];

// Selected status filters. Empty selection means "show all statuses".
export const selectedStatusFilters = ref<TimelineStatus[]>([]);

// Computed visibility states keyed by timeline status.
// When selection is empty, all are visible. Otherwise, only selected are visible.
export const visibleStates = computed(() => {
  const states = {} as Record<TimelineStatus, boolean>;

  if (selectedStatusFilters.value.length === 0) {
    for (const status of ALL_TIMELINE_STATUSES) {
      states[status] = true;
    }
  } else {
    for (const status of ALL_TIMELINE_STATUSES) {
      states[status] = selectedStatusFilters.value.includes(status);
    }
  }

  return states;
});

// Empty selection means "show all tags"
export const selectedProjectTags = ref<string[]>([]);
export const UNTAGGED_PROJECT_FILTER = "__untagged__";

// Size filter: [minMeters, maxMeters]. Infinity = no upper bound.
export const sizeFilterRange = ref<[number, number]>([15, Infinity]);

// Name filter: "named" = projects with a non-empty name, "unnamed" = projects without a name.
// Empty array means show all.
export const selectedNameFilters = ref<("named" | "unnamed")[]>([]);

// Last modified date filter: [minTimestampMs, maxTimestampMs]. Infinity = no upper bound.
// Uses externalLastModified if not null, otherwise updated_at.
export const lastModifiedDateRange = ref([0, Infinity] as [number, number]);

export function toggleNameFilter(value: "named" | "unnamed"): void {
  if (selectedNameFilters.value.includes(value)) {
    selectedNameFilters.value = selectedNameFilters.value.filter((v) => v !== value);
  } else {
    selectedNameFilters.value = [...selectedNameFilters.value, value];
  }
}

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
 * Clear all project tag filters, restoring show-all behavior.
 */
export function clearProjectTagFilters(): void {
  selectedProjectTags.value = [];
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
 * Check whether a project's name matches the name filter.
 */
function matchesNameFilter(name: string | null | undefined): boolean {
  if (selectedNameFilters.value.length === 0) return true;
  // oxlint-disable-next-line no-implicit-coercion
  const hasName = !!name && name.trim().length > 0;
  if (
    selectedNameFilters.value.includes("named") &&
    selectedNameFilters.value.includes("unnamed")
  ) {
    return true;
  }
  if (selectedNameFilters.value.includes("named")) return hasName;
  if (selectedNameFilters.value.includes("unnamed")) return !hasName;
  return true;
}

/**
 * Get the effective last modified timestamp for a project.
 * Uses externalLastModified if not null, otherwise updated_at.
 */
function getEffectiveLastModifiedMs(project: Project): number {
  return new Date(project.externalLastModified ?? project.updatedAt).getTime();
}

/**
 * Check whether a project's last modified date falls within the filter range.
 */
function matchesLastModifiedDateFilter(project: Project): boolean {
  const [minMs, maxMs] = lastModifiedDateRange.value;
  if (minMs === 0 && maxMs === Infinity) return true;
  const ms = getEffectiveLastModifiedMs(project);
  if (ms < minMs) return false;
  if (maxMs !== Infinity && ms > maxMs) return false;
  return true;
}

/**
 * Shared visibility check for standalone project markers.
 * In edit/moderation modes the timeline status filter does not apply.
 */
export function shouldShowStandaloneProject(project: Project, mode: AppMode): boolean {
  if (mode !== "view") {
    const markerColor = getProjectMarkerColor(project, mode);
    // In non-view modes, always show (edit/moderation mode colors are approval-based)
    return (
      markerColor !== undefined &&
      matchesSelectedTags(project.tags) &&
      matchesNameFilter(project.name) &&
      matchesLastModifiedDateFilter(project)
    );
  }
  return (
    visibleStates.value[project.timelineStatus] &&
    matchesSelectedTags(project.tags) &&
    matchesNameFilter(project.name) &&
    matchesLastModifiedDateFilter(project)
  );
}

/**
 * Toggle a specific timeline status filter. Empty selection means all statuses are visible.
 */
export function toggleFilter(status: TimelineStatus): void {
  if (selectedStatusFilters.value.includes(status)) {
    selectedStatusFilters.value = selectedStatusFilters.value.filter((s) => s !== status);
    return;
  }

  selectedStatusFilters.value = [...selectedStatusFilters.value, status];
}

/**
 * Check if a specific overlay should be visible based on current filters.
 * In view mode, also filters out pending overlays (only show approved).
 * In edit/moderation modes, timeline status filter does not apply.
 */
function shouldShowOverlay(overlay: OverlayObject | OverlayData, mode: AppMode) {
  // In view mode only, hide pending overlays (they are visible in edit and moderation modes)
  if (mode === "view" && overlay.status === "pending") {
    return false;
  }

  if (!matchesSelectedTags(overlay.project?.tags)) {
    return false;
  }

  if (mode !== "view") {
    return true;
  }

  // In view mode, filter by the project's timeline status
  const timelineStatus = overlay.project?.timelineStatus;
  if (!timelineStatus) return visibleStates.value["proposed"]; // fallback: treat as proposed
  return visibleStates.value[timelineStatus];
}
