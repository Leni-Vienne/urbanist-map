// Project filter state (timeline status, tags, name, size, date, has-images) shared by
// FilterControl, the vector tile layers, and viewport rendering.

import { ref, computed } from "vue";
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
  // oxlint-disable-next-line no-unsafe-type-assertion
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

// Visibility of one timeline status under the current filter selection.
// Missing or unknown status reads as proposed.
export function matchesTimelineStatusFilter(timelineStatus: string | null | undefined): boolean {
  const states = visibleStates.value;
  if (!timelineStatus) return states.proposed;
  return (states as Record<string, boolean>)[timelineStatus] ?? states.proposed;
}

// Empty array = show all tags.
export const selectedProjectTags = ref<string[]>([]);
export const UNTAGGED_PROJECT_FILTER = "__untagged__";

// [minMeters, maxMeters]. Infinity = no upper bound.
export const sizeFilterRange = ref<[number, number]>([0, Infinity]);

// Empty array = show all. "named" / "unnamed" filter by name presence.
export const selectedNameFilters = ref<("named" | "unnamed")[]>([]);

// [minTimestampMs, maxTimestampMs]. Uses externalLastModified when set, otherwise updated_at.
export const lastModifiedDateRange = ref([0, Infinity] as [number, number]);

export const showOnlyWithImages = ref(false);

export function toggleShowOnlyWithImages(): void {
  showOnlyWithImages.value = !showOnlyWithImages.value;
}

export function toggleNameFilter(value: "named" | "unnamed"): void {
  if (selectedNameFilters.value.includes(value)) {
    selectedNameFilters.value = selectedNameFilters.value.filter((v) => v !== value);
  } else {
    selectedNameFilters.value = [...selectedNameFilters.value, value];
  }
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

export function matchesNameFilter(name: string | null | undefined): boolean {
  const mode = getNameFilterMode();
  if (mode === "all") return true;
  const isNamed = name !== null && name !== undefined && name !== "";
  return mode === "named" ? isNamed : !isNamed;
}

export function matchesSelectedTags(tags: string[] | null | undefined): boolean {
  if (selectedProjectTags.value.length === 0) return true;

  const { includeUntagged, knownTags } = splitTagSelection();
  if (!tags || tags.length === 0) return includeUntagged;
  if (knownTags.length === 0) return false;
  return tags.some((tag) => knownTags.includes(tag));
}

// Empty selection = all statuses visible.
export function toggleFilter(status: TimelineStatus): void {
  if (selectedStatusFilters.value.includes(status)) {
    selectedStatusFilters.value = selectedStatusFilters.value.filter((s) => s !== status);
    return;
  }

  selectedStatusFilters.value = [...selectedStatusFilters.value, status];
}
