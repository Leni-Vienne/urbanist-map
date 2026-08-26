// Project filter state (timeline status, tags, name, size, date, has-images), shared by every
// surface that narrows the project set.

import { ref, computed, watch } from "vue";
import type { TimelineStatus } from "../../../../back/src/db/schema";

const TIMELINE_STATUSES = [
  "proposed",
  "planned",
  "under_construction",
  "completed",
  "canceled",
] as const satisfies readonly TimelineStatus[];

// Narrow a raw status string (vector tile property, wire payload) to a known status, or null.
export function parseTimelineStatus(value: string | null | undefined): TimelineStatus | null {
  if (!value) return null;
  return TIMELINE_STATUSES.find((status) => status === value) ?? null;
}

// Empty array = show all statuses.
export const selectedStatusFilters = ref<TimelineStatus[]>([]);

// Empty array = show all tags.
export const selectedProjectTags = ref<string[]>([]);
export const UNTAGGED_PROJECT_FILTER = "__untagged__";

// [minMeters, maxMeters]. Infinity = no upper bound.
export const sizeFilterRange = ref<[number, number]>([0, Infinity]);

export const selectedNameFilter = ref<"named" | "unnamed" | null>(null);

// [minTimestampMs, maxTimestampMs]. Uses externalLastModified when set, otherwise updated_at.
export const lastModifiedDateRange = ref([0, Infinity] as [number, number]);

export const showOnlyWithImages = ref(false);

export function toggleShowOnlyWithImages(): void {
  showOnlyWithImages.value = !showOnlyWithImages.value;
}

export function toggleNameFilter(value: "named" | "unnamed"): void {
  selectedNameFilter.value = selectedNameFilter.value === value ? null : value;
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

export function splitTagSelection() {
  const selected = selectedProjectTags.value;
  return {
    includeUntagged: selected.includes(UNTAGGED_PROJECT_FILTER),
    knownTags: selected.filter((tag) => tag !== UNTAGGED_PROJECT_FILTER),
  };
}

export function getNameFilterMode(): "all" | "named" | "unnamed" {
  return selectedNameFilter.value ?? "all";
}

export type FilterableProject = {
  tags?: readonly string[] | null;
  timelineStatus?: string | null;
  name?: string | null;
  geometrySizeM?: number | null;
  lastModifiedMs?: number | null;
  hasImage: boolean;
};

function matchesTags(tags: readonly string[] | null | undefined): boolean {
  const { includeUntagged, knownTags } = splitTagSelection();
  if (knownTags.length === 0 && !includeUntagged) return true;
  const values = tags ?? [];
  return (values.length === 0 && includeUntagged) || values.some((tag) => knownTags.includes(tag));
}

function matchesRange(value: number | null | undefined, range: [number, number]): boolean {
  const [min, max] = range;
  if (min === 0 && !Number.isFinite(max)) return true;
  if (value === null || value === undefined || !Number.isFinite(value)) return false;
  return value >= min && value <= max;
}

export function matchesProjectFilters(project: FilterableProject): boolean {
  if (!matchesTags(project.tags)) return false;

  const statuses = selectedStatusFilters.value;
  if (statuses.length > 0 && !statuses.some((status) => status === project.timelineStatus)) {
    return false;
  }

  const nameMode = getNameFilterMode();
  const isNamed = Boolean(project.name?.trim());
  if (nameMode !== "all" && isNamed !== (nameMode === "named")) return false;

  if (!matchesRange(project.geometrySizeM, sizeFilterRange.value)) return false;
  if (!matchesRange(project.lastModifiedMs, lastModifiedDateRange.value)) return false;

  return !showOnlyWithImages.value || project.hasImage;
}

// Empty selection = all statuses visible.
export function toggleFilter(status: TimelineStatus): void {
  if (selectedStatusFilters.value.includes(status)) {
    selectedStatusFilters.value = selectedStatusFilters.value.filter((s) => s !== status);
    return;
  }

  selectedStatusFilters.value = [...selectedStatusFilters.value, status];
}

// Range slider that only ever commits a single active bound. Tiles carry per-cell min/max, not a
// full distribution, so two active bounds would produce false cluster matches. `isDefault` rewinds
// the handles when the committed range is cleared from elsewhere. Handle positions live here beside
// the range they drive, not in the panel: the panel is mounted twice (desktop popover, mobile tab)
// and the popover destroys its copy on close, so component-owned positions would fall back to the
// full span while a bound was still applied.
function singleBoundSlider(
  max: number,
  commit: (minPos: number, maxPos: number) => void,
  isDefault: () => boolean,
) {
  const positions = ref<[number, number]>([0, max]);
  let prev: [number, number] = [0, max];

  watch(isDefault, (atDefault) => {
    if (!atDefault) return;
    const [minPos, maxPos] = positions.value;
    if (minPos === 0 && maxPos === max) return;
    prev = [0, max];
    positions.value = [0, max];
  });

  watch(positions, ([minPos, maxPos]) => {
    // Collapse crossed handles to the one that didn't move.
    if (minPos > maxPos) {
      const [prevMin] = prev;
      positions.value = minPos !== prevMin ? [maxPos, maxPos] : [minPos, minPos];
      return;
    }
    const [prevMin, prevMax] = prev;
    if (minPos !== prevMin && minPos > 0 && maxPos < max) {
      positions.value = [minPos, max];
      return;
    }
    if (maxPos !== prevMax && maxPos < max && minPos > 0) {
      positions.value = [0, maxPos];
      return;
    }
    prev = [minPos, maxPos];
    commit(minPos, maxPos);
  });

  return positions;
}

// Logarithmic size slider: positions [0, 100] → meters. Position 100 = Infinity (no upper limit).
const LOG_SCALE_REF = 500_001;

function posToMeters(pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= 100) return Infinity;
  return Math.round(LOG_SCALE_REF ** (pos / 100) - 1);
}

function commitSizeRange(minPos: number, maxPos: number): void {
  sizeFilterRange.value = [posToMeters(minPos), posToMeters(maxPos)];
}

function sizeIsDefault(): boolean {
  const [min, max] = sizeFilterRange.value;
  return min === 0 && !Number.isFinite(max);
}

export const sizeSliderPositions = singleBoundSlider(100, commitSizeRange, sizeIsDefault);

// Date slider: reverse-logarithmic in "days ago" so the newest handle gets day-level resolution near
// now (yesterday, 2 days ago...) while older positions span months and years.
const DATE_SLIDER_ORIGIN_YEAR = 2004;
export const DATE_SLIDER_MAX = 100;
const MS_PER_DAY = 86_400_000;
const nowMs = Date.now();
const originMs = new Date(DATE_SLIDER_ORIGIN_YEAR, 0, 1).getTime();
const totalDaysSpan = Math.max(1, (nowMs - originMs) / MS_PER_DAY);

export function posToDaysAgo(pos: number): number {
  return (totalDaysSpan + 1) ** ((DATE_SLIDER_MAX - pos) / DATE_SLIDER_MAX) - 1;
}

export function posToMs(pos: number): number {
  if (pos <= 0) return originMs;
  if (pos >= DATE_SLIDER_MAX) return nowMs;
  return nowMs - posToDaysAgo(pos) * MS_PER_DAY;
}

function commitDateRange(minPos: number, maxPos: number): void {
  const minMs = minPos <= 0 ? 0 : posToMs(minPos);
  const maxMs = maxPos >= DATE_SLIDER_MAX ? Infinity : posToMs(maxPos);
  lastModifiedDateRange.value = [minMs, maxMs];
}

function dateIsDefault(): boolean {
  const [min, max] = lastModifiedDateRange.value;
  return min === 0 && !Number.isFinite(max);
}

export const dateSliderPositions = singleBoundSlider(
  DATE_SLIDER_MAX,
  commitDateRange,
  dateIsDefault,
);

export function formatSizeM(meters: number): string {
  if (!Number.isFinite(meters)) return "500km+";
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${meters}m`;
}

// One applied filter, in a form a list can render as a removable chip. Labels are left to the
// caller so translation stays in the component layer.
export type ActiveFilter =
  | { kind: "tag"; slug: string }
  | { kind: "untagged" }
  | { kind: "status"; status: TimelineStatus }
  | { kind: "name"; value: "named" | "unnamed" }
  | { kind: "size"; min: number; max: number }
  | { kind: "date"; min: number; max: number }
  | { kind: "images" };

export const activeFilters = computed<ActiveFilter[]>(() => {
  const out: ActiveFilter[] = [];
  for (const slug of selectedProjectTags.value) {
    out.push(slug === UNTAGGED_PROJECT_FILTER ? { kind: "untagged" } : { kind: "tag", slug });
  }
  for (const status of selectedStatusFilters.value) {
    out.push({ kind: "status", status });
  }
  if (selectedNameFilter.value) out.push({ kind: "name", value: selectedNameFilter.value });
  const [minSize, maxSize] = sizeFilterRange.value;
  if (minSize > 0 || Number.isFinite(maxSize)) {
    out.push({ kind: "size", min: minSize, max: maxSize });
  }
  const [minDate, maxDate] = lastModifiedDateRange.value;
  if (minDate > 0 || Number.isFinite(maxDate)) {
    out.push({ kind: "date", min: minDate, max: maxDate });
  }
  if (showOnlyWithImages.value) {
    out.push({ kind: "images" });
  }
  return out;
});

export const activeFilterCount = computed(() => activeFilters.value.length);

function resetSizeFilter(): void {
  sizeFilterRange.value = [0, Infinity];
}

function resetDateFilter(): void {
  lastModifiedDateRange.value = [0, Infinity];
}

export function clearActiveFilter(filter: ActiveFilter): void {
  switch (filter.kind) {
    case "tag":
      toggleProjectTagFilter(filter.slug);
      return;
    case "untagged":
      toggleProjectTagFilter(UNTAGGED_PROJECT_FILTER);
      return;
    case "status":
      toggleFilter(filter.status);
      return;
    case "name":
      toggleNameFilter(filter.value);
      return;
    case "size":
      resetSizeFilter();
      return;
    case "date":
      resetDateFilter();
      return;
    case "images":
      showOnlyWithImages.value = false;
      return;
    default:
  }
}

// The filter state in the shape the feed query takes. Infinity bounds are dropped rather than
// serialized, so an absent bound means "unbounded" on the wire.
type FeedFilterInput = {
  tags?: string[];
  includeUntagged?: boolean;
  statuses?: TimelineStatus[];
  minSizeM?: number;
  maxSizeM?: number;
  modifiedAfterMs?: number;
  modifiedBeforeMs?: number;
  named?: "named" | "unnamed";
  onlyWithImages?: boolean;
};

export const feedFilterInput = computed<FeedFilterInput>(() => {
  const { includeUntagged, knownTags } = splitTagSelection();
  const [minSize, maxSize] = sizeFilterRange.value;
  const [minDate, maxDate] = lastModifiedDateRange.value;
  const nameMode = getNameFilterMode();
  return {
    ...(knownTags.length > 0 && { tags: knownTags }),
    ...(includeUntagged && { includeUntagged: true }),
    ...(selectedStatusFilters.value.length > 0 && { statuses: [...selectedStatusFilters.value] }),
    ...(minSize > 0 && { minSizeM: minSize }),
    ...(Number.isFinite(maxSize) && { maxSizeM: maxSize }),
    ...(minDate > 0 && { modifiedAfterMs: minDate }),
    ...(Number.isFinite(maxDate) && { modifiedBeforeMs: maxDate }),
    ...(nameMode !== "all" && { named: nameMode }),
    ...(showOnlyWithImages.value && { onlyWithImages: true }),
  };
});
