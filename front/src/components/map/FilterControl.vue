<template>
  <div class="relative inline-flex">
    <span
      v-if="showFilterHint"
      class="absolute -bottom-1 -right-0.5 w-3 h-3 bg-red-500 rounded-full pointer-events-none z-10"
    />
    <span
      v-else-if="activeFilterCount > 0"
      class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-content-background pointer-events-none z-10"
    />
    <Button
      ref="filterButton"
      @click.stop="toggleFilterPanel"
      @dblclick.stop
      raised
      icon="pi pi-filter"
      v-tooltip.left="{
        value: $t('controls.filter'),
        disabled: isMobile,
      }"
      :severity="showFilterPanel ? undefined : 'secondary'"
    />
  </div>

  <Popover
    ref="filterPanel"
    @click.stop
    @dblclick.stop
    appendTo="body"
    pt:root:class="filter-control-popover"
  >
    <!-- overflow-x hidden removes the spurious horizontal scrollbar from the sliders -->
    <div
      class="min-w-55 overflow-y-auto overflow-x-hidden pr-1"
      style="max-height: min(600px, 70svh)"
    >
      <h3 class="m-0 mb-3 text-[0.95rem] font-semibold text-color">
        {{ $t("map.controls.filterByStatusAndTags") }}
      </h3>

      <div class="flex items-center justify-between mb-1.5">
        <p class="m-0 text-xs font-semibold text-color-secondary uppercase tracking-wide">
          {{ $t("map.controls.filterByTags") }}
        </p>
        <button
          v-if="selectedProjectTags.filter((t) => t !== untaggedFilter).length > 0"
          type="button"
          class="text-xs text-color-secondary underline cursor-pointer bg-transparent border-0 p-0"
          @click.stop="clearTagFilters"
          @dblclick.stop
        >
          {{ $t("map.controls.clearTagFilters") }}
        </button>
      </div>
      <div class="flex flex-wrap gap-2 max-w-75 mb-3">
        <button
          v-for="tag in lineTags"
          :key="tag.slug"
          type="button"
          class="px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all duration-150"
          :class="isTagDisabled(tag.slug) ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'"
          :disabled="isTagDisabled(tag.slug)"
          :aria-pressed="selectedProjectTags.includes(tag.slug)"
          :style="
            selectedProjectTags.includes(tag.slug)
              ? { backgroundColor: tag.color, color: tag.textColor, borderColor: tag.color }
              : theme === 'dark'
                ? {
                    backgroundColor: tag.color + '28',
                    color: tag.textColor,
                    borderColor: tag.color,
                  }
                : { backgroundColor: 'transparent', color: tag.color, borderColor: tag.color }
          "
          @click.stop="toggleTagFilter(tag.slug)"
          @dblclick.stop
        >
          {{ $te(`tags.${tag.slug}`) ? $t(`tags.${tag.slug}`) : tag.slug }}
        </button>
      </div>

      <p class="m-0 mb-1.5 text-[0.7rem] italic text-color-secondary">
        {{ $t("map.controls.buildingTagsHint") }}
      </p>
      <div class="flex flex-wrap gap-2 max-w-75 mb-4">
        <button
          v-for="tag in buildingTags"
          :key="tag.slug"
          type="button"
          class="px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all duration-150"
          :class="isTagDisabled(tag.slug) ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'"
          :disabled="isTagDisabled(tag.slug)"
          :aria-pressed="selectedProjectTags.includes(tag.slug)"
          :style="
            selectedProjectTags.includes(tag.slug)
              ? { backgroundColor: tag.color, color: tag.textColor, borderColor: tag.color }
              : theme === 'dark'
                ? {
                    backgroundColor: tag.color + '28',
                    color: tag.textColor,
                    borderColor: tag.color,
                  }
                : { backgroundColor: 'transparent', color: tag.color, borderColor: tag.color }
          "
          @click.stop="toggleTagFilter(tag.slug)"
          @dblclick.stop
        >
          {{ $te(`tags.${tag.slug}`) ? $t(`tags.${tag.slug}`) : tag.slug }}
        </button>
      </div>

      <p class="m-0 mb-1.5 text-xs font-semibold text-color-secondary uppercase tracking-wide">
        {{ $t("map.controls.filterByStatus") }}
      </p>
      <div class="flex flex-col gap-1 mb-4">
        <label
          v-for="{ timelineStatus, labelKey } in filters"
          :key="timelineStatus"
          class="flex items-center gap-2 cursor-pointer text-sm text-color"
        >
          <input
            type="checkbox"
            :checked="selectedStatusFilters.includes(timelineStatus)"
            @change="toggleCompletionFilter(timelineStatus)"
            @click.stop
          />
          <LinePreview :status="timelineStatus" :color="linePreviewColor" />
          {{ $t(labelKey) }}
        </label>
      </div>

      <p class="m-0 mb-1.5 text-xs font-semibold text-color-secondary uppercase tracking-wide">
        {{ $t("map.controls.filterByName") }}
      </p>
      <div class="flex flex-col gap-1 mb-4">
        <label
          v-for="nameVal in nameFilters"
          :key="nameVal"
          class="flex items-center gap-2 cursor-pointer text-sm text-color"
        >
          <input
            type="checkbox"
            :checked="selectedNameFilters.includes(nameVal)"
            @change="handleToggleNameFilter(nameVal)"
            @click.stop
          />
          {{ $t(`map.controls.${nameVal}`) }}
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-sm text-color">
          <input
            type="checkbox"
            :checked="selectedProjectTags.includes(untaggedFilter)"
            @change="toggleTagFilter(untaggedFilter)"
            @click.stop
          />
          {{ $t("map.controls.untagged") }}
        </label>
      </div>

      <p class="m-0 mb-1.5 text-xs font-semibold text-color-secondary uppercase tracking-wide">
        {{ $t("map.controls.filterByImages") }}
      </p>
      <div class="flex flex-col gap-1 mb-4">
        <label class="flex items-center gap-2 cursor-pointer text-sm text-color">
          <input
            type="checkbox"
            :checked="showOnlyWithImages"
            @change="handleToggleImageFilter"
            @click.stop
          />
          {{ $t("map.controls.onlyWithImages") }}
        </label>
      </div>

      <div class="mb-4">
        <p class="m-0 mb-2 text-xs font-semibold text-color-secondary uppercase tracking-wide">
          {{ $t("map.controls.filterBySize") }}
        </p>
        <div class="px-1">
          <Slider
            v-model="sizeSliderPositions"
            :min="0"
            :max="100"
            :step="1"
            range
            class="w-full"
          />
          <div class="flex justify-between mt-2 text-xs text-color-secondary">
            <span>{{ formatSize(sizeFilterRange[0]) }}</span>
            <span>{{ formatSize(sizeFilterRange[1]) }}</span>
          </div>
        </div>
      </div>

      <div>
        <p class="m-0 mb-2 text-xs font-semibold text-color-secondary uppercase tracking-wide">
          {{ $t("map.controls.filterByLastModified") }}
        </p>
        <div class="px-1">
          <Slider
            v-model="dateSliderPositions"
            :min="0"
            :max="DATE_SLIDER_MAX"
            :step="1"
            range
            class="w-full"
          />
          <div class="flex justify-between mt-2 text-xs text-color-secondary">
            <span
              >{{ $t("map.controls.lastModifiedFrom") }}:
              {{ formatDateSlider(dateSliderPositions[0]) }}</span
            >
            <span
              >{{ $t("map.controls.lastModifiedTo") }}:
              {{ formatDateSlider(dateSliderPositions[1]) }}</span
            >
          </div>
        </div>
      </div>
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import {
  selectedStatusFilters,
  selectedProjectTags,
  toggleFilter,
  toggleProjectTagFilter,
  clearProjectTagFilters,
  UNTAGGED_PROJECT_FILTER,
  sizeFilterRange,
  selectedNameFilters,
  toggleNameFilter,
  lastModifiedDateRange,
  showOnlyWithImages,
  toggleShowOnlyWithImages,
} from "@/services/map/filters";

// Logarithmic slider: positions [0, 100] → meters. Position 100 = Infinity (no upper limit).
const LOG_SCALE_REF = 500_001;

function posToMeters(pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= 100) return Infinity;
  return Math.round(LOG_SCALE_REF ** (pos / 100) - 1);
}

const sizeSliderPositions = ref<[number, number]>([20, 100]);
const prevSizeSliderPositions = ref<[number, number]>([0, 100]);

watch(sizeSliderPositions, ([minPos, maxPos]) => {
  // Collapse crossed handles to the one that didn't move.
  if (minPos > maxPos) {
    const [prevMin] = prevSizeSliderPositions.value;
    sizeSliderPositions.value = minPos !== prevMin ? [maxPos, maxPos] : [minPos, minPos];
    return;
  }
  const [prevMin, prevMax] = prevSizeSliderPositions.value;
  // Single-bound only: tiles carry per-cell min/max, not a full distribution,
  // so two active bounds would produce false cluster matches.
  if (minPos !== prevMin && minPos > 0 && maxPos < 100) {
    sizeSliderPositions.value = [minPos, 100];
    return;
  }
  if (maxPos !== prevMax && maxPos < 100 && minPos > 0) {
    sizeSliderPositions.value = [0, maxPos];
    return;
  }
  prevSizeSliderPositions.value = [minPos, maxPos];
  sizeFilterRange.value = [posToMeters(minPos), posToMeters(maxPos)];
});

// Date slider: each step is one month.
const DATE_SLIDER_ORIGIN_YEAR = 2004;
const _now = new Date();
const DATE_SLIDER_MAX = (_now.getFullYear() - DATE_SLIDER_ORIGIN_YEAR) * 12 + _now.getMonth();

const dateSliderPositions = ref<[number, number]>([0, DATE_SLIDER_MAX]);
const prevDateSliderPositions = ref<[number, number]>([0, DATE_SLIDER_MAX]);

function posToDate(pos: number): Date {
  const totalMonths = DATE_SLIDER_ORIGIN_YEAR * 12 + pos;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths % 12;
  return new Date(year, month, 1);
}

function formatDateSlider(pos: number): string {
  const d = posToDate(pos);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

watch(dateSliderPositions, ([minPos, maxPos]) => {
  // Collapse crossed handles to the one that didn't move.
  if (minPos > maxPos) {
    const [prevMin] = prevDateSliderPositions.value;
    dateSliderPositions.value = minPos !== prevMin ? [maxPos, maxPos] : [minPos, minPos];
    return;
  }
  const [prevMin, prevMax] = prevDateSliderPositions.value;
  // Single-bound only, same reason as size slider.
  if (minPos !== prevMin && minPos > 0 && maxPos < DATE_SLIDER_MAX) {
    dateSliderPositions.value = [minPos, DATE_SLIDER_MAX];
    return;
  }
  if (maxPos !== prevMax && maxPos < DATE_SLIDER_MAX && minPos > 0) {
    dateSliderPositions.value = [0, maxPos];
    return;
  }
  prevDateSliderPositions.value = [minPos, maxPos];
  const minMs = posToDate(minPos).getTime();
  const maxMs = maxPos >= DATE_SLIDER_MAX ? Infinity : posToDate(maxPos).getTime();
  lastModifiedDateRange.value = [minMs, maxMs];
});

const nameFilters: ("named" | "unnamed")[] = ["named", "unnamed"];

function handleToggleNameFilter(value: "named" | "unnamed") {
  toggleNameFilter(value);
  emit("filter-overlays");
}

function handleToggleImageFilter() {
  toggleShowOnlyWithImages();
  emit("filter-overlays");
}

function formatSize(meters: number): string {
  if (!Number.isFinite(meters)) return "100km+";
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${meters}m`;
}
import type { TimelineStatus } from "../../../../back/src/db/schema";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import {
  PROJECT_TAGS,
  PROJECT_TAG_MAP,
  BUILDING_CATEGORY_TAGS,
  BUILDING_FILTER_MIN_ZOOM,
} from "@/config/projectTags";
import { currentZoomLevel } from "@/services/core/map";
import { useTheme } from "@/composables/core/useTheme";
import LinePreview from "@/components/common/LinePreview.vue";

// "canceled" is omitted, too confusing for most users.
const filters: {
  timelineStatus: TimelineStatus;
  labelKey: string;
}[] = [
  { timelineStatus: "proposed", labelKey: "timelineStatus.proposed" },
  { timelineStatus: "planned", labelKey: "timelineStatus.planned" },
  { timelineStatus: "under_construction", labelKey: "timelineStatus.under_construction" },
];

// Use the active tag color for line previews when exactly one tag is selected.
const linePreviewColor = computed(() => {
  const tagSlugs = selectedProjectTags.value.filter((t) => t !== UNTAGGED_PROJECT_FILTER);
  if (tagSlugs.length === 1) {
    return PROJECT_TAG_MAP.get(tagSlugs[0] ?? "")?.color ?? "#6b7280";
  }
  return "#6b7280";
});

const { isMobile } = useIsMobile();
const { theme } = useTheme();
const allTags = PROJECT_TAGS.filter((t) => !t.hidden);
const lineTags = allTags.filter((t) => !BUILDING_CATEGORY_TAGS.has(t.slug));
const buildingTags = allTags.filter((t) => BUILDING_CATEGORY_TAGS.has(t.slug));
const untaggedFilter = UNTAGGED_PROJECT_FILTER;

const activeFilterCount = computed(() => {
  let count =
    selectedStatusFilters.value.length +
    selectedProjectTags.value.length +
    selectedNameFilters.value.length;
  if (Number.isFinite(sizeFilterRange.value[0]) && sizeFilterRange.value[0] > 0) count += 1;
  if (Number.isFinite(sizeFilterRange.value[1])) count += 1;
  if (lastModifiedDateRange.value[0] > 0) count += 1;
  if (Number.isFinite(lastModifiedDateRange.value[1])) count += 1;
  if (showOnlyWithImages.value) count += 1;
  return count;
});

const FILTER_HINT_KEY = "filter-control-seen";
const showFilterHint = ref(localStorage.getItem(FILTER_HINT_KEY) !== "1");
const showFilterPanel = ref(false);
const filterPanel = ref();

const emit = defineEmits<{
  "filter-overlays": [];
}>();

function toggleFilterPanel(event: Event) {
  if (showFilterHint.value) {
    showFilterHint.value = false;
    localStorage.setItem(FILTER_HINT_KEY, "1");
  }
  filterPanel.value.toggle(event);
  showFilterPanel.value = !showFilterPanel.value;
}

function toggleCompletionFilter(status: TimelineStatus) {
  toggleFilter(status);
  emit("filter-overlays");
}

// Building-category markers are suppressed server-side at low zoom (see tiles.sql), so their
// filters are disabled until the user zooms in enough for those markers to appear.
function isTagDisabled(slug: string): boolean {
  return BUILDING_CATEGORY_TAGS.has(slug) && currentZoomLevel.value < BUILDING_FILTER_MIN_ZOOM;
}

function toggleTagFilter(slug: string) {
  if (isTagDisabled(slug)) return;
  toggleProjectTagFilter(slug);
  emit("filter-overlays");
}

function clearTagFilters() {
  clearProjectTagFilters();
  emit("filter-overlays");
}

watch(
  () => filterPanel.value?.visible,
  (visible) => {
    showFilterPanel.value = visible ?? false;
  },
);

defineExpose({
  filterPanel,
});
</script>
