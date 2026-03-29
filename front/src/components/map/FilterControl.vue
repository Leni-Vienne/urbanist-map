<template>
  <!-- Filter Button (View Mode Only) - Opens Popover -->
  <div class="relative inline-flex">
    <span
      v-if="showFilterHint"
      class="absolute -bottom-1 -right-0.5 w-3 h-3 bg-red-500 rounded-full pointer-events-none z-10"
    />
    <Button
      ref="filterButton"
      @click.stop="toggleFilterPanel"
      @dblclick.stop
      raised
      icon="pi pi-filter"
      v-tooltip.right="{
        value: $t('controls.filter'),
        disabled: isMobile,
      }"
      :severity="showFilterPanel ? undefined : 'secondary'"
      :badge="activeFilterCount > 0 ? String(activeFilterCount) : undefined"
      badge-severity="contrast"
    />
  </div>

  <!-- Filter Popover (View Mode Only) -->
  <Popover ref="filterPanel" @click.stop @dblclick.stop appendTo="body">
    <div class="min-w-55">
      <div class="flex items-center justify-between mb-3">
        <h3 class="m-0 text-[0.95rem] font-semibold text-color">
          {{ $t("map.controls.filterByStatusAndTags") }}
        </h3>
        <button
          v-if="selectedProjectTags.length > 0"
          type="button"
          class="text-xs text-color-secondary underline cursor-pointer bg-transparent border-0 p-0"
          @click.stop="clearTagFilters"
          @dblclick.stop
        >
          {{ $t("map.controls.clearTagFilters") }}
        </button>
      </div>
      <div class="flex flex-wrap gap-2 max-w-70">
        <button
          v-for="{ color, labelKey, ariaKey } in filters"
          :key="color"
          type="button"
          class="px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all duration-150 cursor-pointer"
          :aria-pressed="selectedStatusFilters.includes(color)"
          :style="getStatusButtonStyle(color)"
          @click.stop="toggleCompletionFilter(color)"
          @dblclick.stop
          :aria-label="$t(ariaKey)"
        >
          {{ $t(labelKey) }}
        </button>

        <button
          type="button"
          class="px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all duration-150 cursor-pointer"
          :aria-pressed="selectedProjectTags.includes(untaggedFilter)"
          :style="
            selectedProjectTags.includes(untaggedFilter)
              ? {
                  backgroundColor: 'var(--p-surface-500)',
                  color: 'var(--p-surface-0)',
                  borderColor: 'var(--p-surface-500)',
                }
              : {
                  backgroundColor: 'transparent',
                  color: 'var(--p-text-color-secondary)',
                  borderColor: 'var(--p-surface-400)',
                }
          "
          @click.stop="toggleTagFilter(untaggedFilter)"
          @dblclick.stop
        >
          {{ $t("map.controls.untagged") }}
        </button>

        <button
          v-for="nameVal in nameFilters"
          :key="nameVal"
          type="button"
          class="px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all duration-150 cursor-pointer"
          :aria-pressed="selectedNameFilters.includes(nameVal)"
          :style="
            selectedNameFilters.includes(nameVal)
              ? {
                  backgroundColor: 'var(--p-surface-500)',
                  color: 'var(--p-surface-0)',
                  borderColor: 'var(--p-surface-500)',
                }
              : {
                  backgroundColor: 'transparent',
                  color: 'var(--p-text-color-secondary)',
                  borderColor: 'var(--p-surface-400)',
                }
          "
          @click.stop="handleToggleNameFilter(nameVal)"
          @dblclick.stop
        >
          {{ $t(`map.controls.${nameVal}`) }}
        </button>

        <button
          v-for="tag in allTags"
          :key="tag.slug"
          type="button"
          class="px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all duration-150 cursor-pointer"
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

      <div class="mt-4">
        <h3 class="m-0 mb-2 text-[0.95rem] font-semibold text-color">
          {{ $t("map.controls.filterBySize") }}
        </h3>
        <div class="px-1">
          <Slider v-model="sliderPositions" :min="0" :max="100" :step="1" range class="w-full" />
          <div class="flex justify-between mt-2 text-xs text-color-secondary">
            <span>{{ formatSize(sizeFilterRange[0]) }}</span>
            <span>{{ formatSize(sizeFilterRange[1]) }}</span>
          </div>
        </div>
      </div>

      <div class="mt-4">
        <h3 class="m-0 mb-2 text-[0.95rem] font-semibold text-color">
          {{ $t("map.controls.filterByLastModified") }}
        </h3>
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
} from "@/services/overlay/statusFilters";
import Slider from "primevue/slider";

// Logarithmic slider: internal positions are [0, 100], mapped to meters via a log curve.
// LOG_SCALE_REF is only used to shape the curve — it is NOT a filter ceiling.
// Position 100 maps to Infinity (no upper limit).
const LOG_SCALE_REF = 500_001;

function posToMeters(pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= 100) return Infinity;
  return Math.round(LOG_SCALE_REF ** (pos / 100) - 1);
}

const sliderPositions = ref<[number, number]>([0, 100]);

watch(sliderPositions, ([minPos, maxPos]) => {
  sizeFilterRange.value = [posToMeters(minPos), posToMeters(maxPos)];
});

// Date slider: each step is one month, from DATE_SLIDER_ORIGIN_YEAR to current month.
const DATE_SLIDER_ORIGIN_YEAR = 2004;
const _now = new Date();
const DATE_SLIDER_MAX = (_now.getFullYear() - DATE_SLIDER_ORIGIN_YEAR) * 12 + _now.getMonth();

const dateSliderPositions = ref<[number, number]>([0, DATE_SLIDER_MAX]);

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
  const minMs = posToDate(minPos).getTime();
  const maxMs = maxPos >= DATE_SLIDER_MAX ? Infinity : posToDate(maxPos).getTime();
  lastModifiedDateRange.value = [minMs, maxMs];
});

const nameFilters: ("named" | "unnamed")[] = ["named", "unnamed"];

function handleToggleNameFilter(value: "named" | "unnamed") {
  toggleNameFilter(value);
  emit("filter-overlays");
}

function formatSize(meters: number): string {
  if (!Number.isFinite(meters)) return "100km+";
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${meters}m`;
}
import { markerColors } from "@/services/map/markers";
import type { viewModeMarkerColor } from "@/types/index";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import { PROJECT_TAGS } from "@/config/projectTags";
import { useTheme } from "@/composables/core/useTheme";

const filters: { color: viewModeMarkerColor; labelKey: string; ariaKey: string }[] = [
  { color: "yellow", labelKey: "timelineStatus.proposed", ariaKey: "map.controls.toggleProposed" },
  { color: "blue", labelKey: "timelineStatus.planned", ariaKey: "map.controls.togglePlanned" },
  {
    color: "orange",
    labelKey: "timelineStatus.under_construction",
    ariaKey: "map.controls.toggleInProgress",
  },
  { color: "green", labelKey: "timelineStatus.completed", ariaKey: "map.controls.toggleCompleted" },
  { color: "grey", labelKey: "timelineStatus.canceled", ariaKey: "map.controls.toggleCanceled" },
];

const { isMobile } = useIsMobile();
const { theme } = useTheme();
const allTags = PROJECT_TAGS;
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
  return count;
});

const FILTER_HINT_KEY = "filter-control-seen";
const showFilterHint = ref(localStorage.getItem(FILTER_HINT_KEY) !== "1");

// Panel visibility state
const showFilterPanel = ref(false);

// Ref for the popover
const filterPanel = ref();

// Emit events to parent for complex operations
const emit = defineEmits<{
  "filter-overlays": [];
}>();

// Get button style based on selection state
function getStatusButtonStyle(color: viewModeMarkerColor) {
  const baseColor = markerColors[color];
  const isSelected = selectedStatusFilters.value.includes(color);

  if (isSelected) {
    return {
      backgroundColor: baseColor,
      color: getContrastTextColor(baseColor),
      borderColor: baseColor,
    };
  }

  return {
    backgroundColor: "transparent",
    color: baseColor,
    borderColor: baseColor,
  };
}

// Determine if text should be white or dark based on background color
function getContrastTextColor(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  const r = Number.parseInt(hex.substring(0, 2), 16);
  const g = Number.parseInt(hex.substring(2, 4), 16);
  const b = Number.parseInt(hex.substring(4, 6), 16);
  // Using relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#1a1a1a" : "#ffffff";
}

// Toggle filter panel visibility
function toggleFilterPanel(event: Event) {
  if (showFilterHint.value) {
    showFilterHint.value = false;
    localStorage.setItem(FILTER_HINT_KEY, "1");
  }
  filterPanel.value.toggle(event);
  showFilterPanel.value = !showFilterPanel.value;
}

// Toggle completion status filter
function toggleCompletionFilter(color: viewModeMarkerColor) {
  toggleFilter(color);
  emit("filter-overlays");
}

function toggleTagFilter(slug: string) {
  toggleProjectTagFilter(slug);
  emit("filter-overlays");
}

function clearTagFilters() {
  clearProjectTagFilters();
  emit("filter-overlays");
}

// Watch for popover visibility changes
watch(
  () => filterPanel.value?.visible,
  (visible) => {
    showFilterPanel.value = visible ?? false;
  },
);

// Expose the filter panel ref so parent can close it when needed
defineExpose({
  filterPanel,
});
</script>
