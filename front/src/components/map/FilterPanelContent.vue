<template>
  <h3 v-if="showHeading" class="m-0 mb-3 text-[0.95rem] font-semibold text-color">
    {{ $t("map.controls.filterByStatusAndTags") }}
  </h3>

  <div class="flex items-center justify-between mb-1.5">
    <p class="m-0 text-xs font-semibold text-color-secondary uppercase tracking-wide">
      {{ $t("map.controls.filterByTags") }}
    </p>
    <button
      v-if="selectedProjectTags.filter((slug) => slug !== untaggedFilter).length > 0"
      type="button"
      class="text-xs text-color-secondary underline cursor-pointer bg-transparent border-0 p-0"
      @click="clearTagFilters"
      @dblclick.stop
    >
      {{ $t("map.controls.clearTagFilters") }}
    </button>
  </div>
  <div class="flex flex-wrap gap-2 mb-3">
    <button
      v-for="tag in lineTags"
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
      @click="toggleTagFilter(tag.slug)"
      @dblclick.stop
    >
      {{ $te(`tags.${tag.slug}`) ? $t(`tags.${tag.slug}`) : tag.slug }}
    </button>
  </div>

  <p class="m-0 mb-1.5 text-[0.7rem] italic text-color-secondary">
    {{ $t("map.controls.buildingTagsHint") }}
  </p>
  <div class="flex flex-wrap gap-2 mb-4">
    <button
      v-for="tag in buildingTags"
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
      @click="toggleTagFilter(tag.slug)"
      @dblclick.stop
    >
      {{ $te(`tags.${tag.slug}`) ? $t(`tags.${tag.slug}`) : tag.slug }}
    </button>
  </div>

  <p class="m-0 mb-1.5 text-xs font-semibold text-color-secondary uppercase tracking-wide">
    {{ $t("map.controls.filterByImages") }}
  </p>
  <div class="flex flex-col gap-1 mb-4">
    <label class="flex items-center gap-2 cursor-pointer text-sm text-color">
      <input type="checkbox" :checked="showOnlyWithImages" @change="handleToggleImageFilter" />
      {{ $t("map.controls.onlyWithImages") }}
    </label>
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
      />
      {{ $t(`map.controls.${nameVal}`) }}
    </label>
    <label class="flex items-center gap-2 cursor-pointer text-sm text-color">
      <input
        type="checkbox"
        :checked="selectedProjectTags.includes(untaggedFilter)"
        @change="toggleTagFilter(untaggedFilter)"
      />
      {{ $t("map.controls.untagged") }}
    </label>
  </div>

  <div class="mb-4">
    <p class="m-0 mb-2 text-xs font-semibold text-color-secondary uppercase tracking-wide">
      {{ $t("map.controls.filterBySize") }}
    </p>
    <div class="px-1">
      <!-- @vue-expect-error PrimeVue v-model type mismatch -->
      <Slider v-model="sizeSliderPositions" :min="0" :max="100" :step="1" range class="w-full" />
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
      <!-- @vue-expect-error PrimeVue v-model type mismatch -->
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
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
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
import type { TimelineStatus } from "../../../../back/src/db/schema";
import { PROJECT_TAGS, PROJECT_TAG_MAP, BUILDING_CATEGORY_TAGS } from "@/constants/projectTags";
import { useTheme } from "@/composables/core/useTheme";
import LinePreview from "@/components/common/LinePreview.vue";

const emit = defineEmits<{
  "filter-overlays": [];
}>();

withDefaults(defineProps<{ showHeading?: boolean }>(), { showHeading: true });

const { t } = useI18n();

// Logarithmic slider: positions [0, 100] → meters. Position 100 = Infinity (no upper limit).
const LOG_SCALE_REF = 500_001;

function posToMeters(pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= 100) return Infinity;
  return Math.round(LOG_SCALE_REF ** (pos / 100) - 1);
}

const sizeSliderPositions = ref<[number, number]>([0, 100]);
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

// Date slider: reverse-logarithmic in "days ago" so the newest handle gets day-level
// resolution near now (yesterday, 2 days ago...) while older positions span months and years.
const DATE_SLIDER_ORIGIN_YEAR = 2004;
const DATE_SLIDER_MAX = 100;
const MS_PER_DAY = 86_400_000;
const currentDate = new Date();
const nowMs = currentDate.getTime();
const originMs = new Date(DATE_SLIDER_ORIGIN_YEAR, 0, 1).getTime();
const totalDaysSpan = Math.max(1, (nowMs - originMs) / MS_PER_DAY);

const dateSliderPositions = ref<[number, number]>([0, DATE_SLIDER_MAX]);
const prevDateSliderPositions = ref<[number, number]>([0, DATE_SLIDER_MAX]);

function posToDaysAgo(pos: number): number {
  return (totalDaysSpan + 1) ** ((DATE_SLIDER_MAX - pos) / DATE_SLIDER_MAX) - 1;
}

function posToMs(pos: number): number {
  if (pos <= 0) return originMs;
  if (pos >= DATE_SLIDER_MAX) return nowMs;
  return nowMs - posToDaysAgo(pos) * MS_PER_DAY;
}

function formatDateSlider(pos: number): string {
  const daysAgo = Math.round(posToDaysAgo(pos));
  if (daysAgo <= 0) return t("map.controls.today");
  if (daysAgo === 1) return t("map.controls.yesterday");
  if (daysAgo < 30) return t("map.controls.daysAgo", { n: daysAgo });
  const d = new Date(posToMs(pos));
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
  const minMs = minPos <= 0 ? 0 : posToMs(minPos);
  const maxMs = maxPos >= DATE_SLIDER_MAX ? Infinity : posToMs(maxPos);
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
  if (!Number.isFinite(meters)) return "500km+";
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${meters}m`;
}

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
  const tagSlugs = selectedProjectTags.value.filter((slug) => slug !== UNTAGGED_PROJECT_FILTER);
  if (tagSlugs.length === 1) {
    return PROJECT_TAG_MAP.get(tagSlugs[0] ?? "")?.color ?? "#6b7280";
  }
  return "#6b7280";
});

const { theme } = useTheme();
const allTags = PROJECT_TAGS.filter((tag) => !tag.hidden);
const lineTags = allTags.filter((tag) => !BUILDING_CATEGORY_TAGS.has(tag.slug));
const buildingTags = allTags.filter((tag) => BUILDING_CATEGORY_TAGS.has(tag.slug));
const untaggedFilter = UNTAGGED_PROJECT_FILTER;

function toggleCompletionFilter(status: TimelineStatus) {
  toggleFilter(status);
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
</script>
