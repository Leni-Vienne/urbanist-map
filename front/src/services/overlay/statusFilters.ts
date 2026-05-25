import { ref, computed } from "vue";
import type { Project, OverlayData, OverlayObject } from "@/types/index";
import type { AppMode } from "@shared/types";
import type { TimelineStatus } from "../../../../back/src/db/schema";

const ALL_TIMELINE_STATUSES: TimelineStatus[] = [
  "proposed",
  "planned",
  "under_construction",
  "completed",
  "canceled",
];

// Empty array = show all statuses.
export const selectedStatusFilters = ref<TimelineStatus[]>([]);

// Visibility per timeline status. When selection is empty, all are true.
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

// Empty array = show all tags.
export const selectedProjectTags = ref<string[]>([]);
export const UNTAGGED_PROJECT_FILTER = "__untagged__";

// [minMeters, maxMeters]. Infinity = no upper bound.
export const sizeFilterRange = ref<[number, number]>([15, Infinity]);

// Empty array = show all. "named" / "unnamed" filter by name presence.
export const selectedNameFilters = ref<("named" | "unnamed")[]>([]);

// [minTimestampMs, maxTimestampMs]. Uses externalLastModified when set, otherwise updated_at.
export const lastModifiedDateRange = ref([0, Infinity] as [number, number]);

export function toggleNameFilter(value: "named" | "unnamed"): void {
  if (selectedNameFilters.value.includes(value)) {
    selectedNameFilters.value = selectedNameFilters.value.filter((v) => v !== value);
  } else {
    selectedNameFilters.value = [...selectedNameFilters.value, value];
  }
}

export function filterByStatus<T extends OverlayObject | OverlayData>(
  overlays: T[],
  mode: AppMode,
): T[] {
  return overlays.filter((overlay) => shouldShowOverlay(overlay, mode));
}

export function clearProjectTagFilters(): void {
  selectedProjectTags.value = [];
}

export function toggleProjectTagFilter(tag: string): void {
  if (selectedProjectTags.value.includes(tag)) {
    selectedProjectTags.value = selectedProjectTags.value.filter((t) => t !== tag);
    return;
  }

  selectedProjectTags.value = [...selectedProjectTags.value, tag];
}

export function splitTagSelection(): { includeUntagged: boolean; knownTags: string[] } {
  const selected = selectedProjectTags.value;
  return {
    includeUntagged: selected.includes(UNTAGGED_PROJECT_FILTER),
    knownTags: selected.filter((tag) => tag !== UNTAGGED_PROJECT_FILTER),
  };
}

export function getNameFilterMode(): "all" | "named" | "unnamed" {
  const selected = selectedNameFilters.value;
  if (selected.length === 0) return "all";
  const named = selected.includes("named");
  const unnamed = selected.includes("unnamed");
  if (named && unnamed) return "all";
  return named ? "named" : "unnamed";
}

function matchesSelectedTags(tags: string[] | null | undefined): boolean {
  if (selectedProjectTags.value.length === 0) return true;

  const { includeUntagged, knownTags } = splitTagSelection();
  if (!tags || tags.length === 0) return includeUntagged;
  if (knownTags.length === 0) return false;
  return tags.some((tag) => knownTags.includes(tag));
}

function matchesNameFilter(name: string | null | undefined): boolean {
  const mode = getNameFilterMode();
  if (mode === "all") return true;
  // oxlint-disable-next-line no-implicit-coercion
  const hasName = !!name && name.trim().length > 0;
  return mode === "named" ? hasName : !hasName;
}

function getEffectiveLastModifiedMs(project: Project): number {
  return new Date(project.externalLastModified ?? project.updatedAt).getTime();
}

function matchesLastModifiedDateFilter(project: Project): boolean {
  const [minMs, maxMs] = lastModifiedDateRange.value;
  if (minMs === 0 && maxMs === Infinity) return true;
  const ms = getEffectiveLastModifiedMs(project);
  if (ms < minMs) return false;
  if (maxMs !== Infinity && ms > maxMs) return false;
  return true;
}

export function shouldShowStandaloneProject(project: Project, mode: AppMode): boolean {
  const passesCommonFilters =
    matchesSelectedTags(project.tags) &&
    matchesNameFilter(project.name) &&
    matchesLastModifiedDateFilter(project);

  // The timeline status filter only applies in view mode.
  if (mode === "view") {
    return passesCommonFilters && visibleStates.value[project.timelineStatus];
  }
  return passesCommonFilters;
}

// Empty selection = all statuses visible.
export function toggleFilter(status: TimelineStatus): void {
  if (selectedStatusFilters.value.includes(status)) {
    selectedStatusFilters.value = selectedStatusFilters.value.filter((s) => s !== status);
    return;
  }

  selectedStatusFilters.value = [...selectedStatusFilters.value, status];
}

function shouldShowOverlay(overlay: OverlayObject | OverlayData, mode: AppMode) {
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
  if (!timelineStatus) return visibleStates.value.proposed; // fallback: treat as proposed
  return visibleStates.value[timelineStatus];
}
