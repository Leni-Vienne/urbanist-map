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
      @click="clearProjectTagFilters"
      @dblclick.stop
    >
      {{ $t("map.controls.clearTagFilters") }}
    </button>
  </div>
  <template v-for="group in tagGroups" :key="group.key">
    <p v-if="group.hintKey" class="m-0 mb-1.5 text-[0.7rem] italic text-color-secondary">
      {{ $t(group.hintKey) }}
    </p>
    <div class="flex flex-wrap gap-2 mb-4">
      <button
        v-for="tag in group.tags"
        :key="tag.slug"
        type="button"
        class="px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all duration-150 cursor-pointer"
        :aria-pressed="selectedProjectTags.includes(tag.slug)"
        :style="tagStyle(tag)"
        @click="toggleProjectTagFilter(tag.slug)"
        @dblclick.stop
      >
        {{ $te(`tags.${tag.slug}`) ? $t(`tags.${tag.slug}`) : tag.slug }}
      </button>
    </div>
  </template>

  <p class="m-0 mb-1.5 text-xs font-semibold text-color-secondary uppercase tracking-wide">
    {{ $t("map.controls.filterByImages") }}
  </p>
  <div class="flex flex-col gap-1 mb-4">
    <label class="flex items-center gap-2 cursor-pointer text-sm text-color">
      <input type="checkbox" :checked="showOnlyWithImages" @change="toggleShowOnlyWithImages" />
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
        @change="toggleFilter(timelineStatus)"
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
        @change="toggleNameFilter(nameVal)"
      />
      {{ $t(`map.controls.${nameVal}`) }}
    </label>
    <label class="flex items-center gap-2 cursor-pointer text-sm text-color">
      <input
        type="checkbox"
        :checked="selectedProjectTags.includes(untaggedFilter)"
        @change="toggleProjectTagFilter(untaggedFilter)"
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
import {
  PROJECT_TAGS,
  PROJECT_TAG_MAP,
  BUILDING_CATEGORY_TAGS,
  type ProjectTag,
} from "@/constants/projectTags";
import { useTheme } from "@/composables/core/useTheme";
import LinePreview from "@/components/common/LinePreview.vue";

withDefaults(defineProps<{ showHeading?: boolean }>(), { showHeading: true });

const { t } = useI18n();

// Range slider that only ever commits a single active bound. Tiles carry per-cell min/max,
// not a full distribution, so two active bounds would produce false cluster matches.
function useSingleBoundSlider(max: number, commit: (minPos: number, maxPos: number) => void) {
  const positions = ref<[number, number]>([0, max]);
  const prev = ref<[number, number]>([0, max]);

  watch(positions, ([minPos, maxPos]) => {
    // Collapse crossed handles to the one that didn't move.
    if (minPos > maxPos) {
      const [prevMin] = prev.value;
      positions.value = minPos !== prevMin ? [maxPos, maxPos] : [minPos, minPos];
      return;
    }
    const [prevMin, prevMax] = prev.value;
    if (minPos !== prevMin && minPos > 0 && maxPos < max) {
      positions.value = [minPos, max];
      return;
    }
    if (maxPos !== prevMax && maxPos < max && minPos > 0) {
      positions.value = [0, maxPos];
      return;
    }
    prev.value = [minPos, maxPos];
    commit(minPos, maxPos);
  });

  return positions;
}

// Logarithmic slider: positions [0, 100] → meters. Position 100 = Infinity (no upper limit).
const LOG_SCALE_REF = 500_001;

function posToMeters(pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= 100) return Infinity;
  return Math.round(LOG_SCALE_REF ** (pos / 100) - 1);
}

function commitSizeRange(minPos: number, maxPos: number) {
  sizeFilterRange.value = [posToMeters(minPos), posToMeters(maxPos)];
}

const sizeSliderPositions = useSingleBoundSlider(100, commitSizeRange);

// Date slider: reverse-logarithmic in "days ago" so the newest handle gets day-level
// resolution near now (yesterday, 2 days ago...) while older positions span months and years.
const DATE_SLIDER_ORIGIN_YEAR = 2004;
const DATE_SLIDER_MAX = 100;
const MS_PER_DAY = 86_400_000;
const currentDate = new Date();
const nowMs = currentDate.getTime();
const originMs = new Date(DATE_SLIDER_ORIGIN_YEAR, 0, 1).getTime();
const totalDaysSpan = Math.max(1, (nowMs - originMs) / MS_PER_DAY);

const dateSliderPositions = useSingleBoundSlider(DATE_SLIDER_MAX, commitDateRange);

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

function commitDateRange(minPos: number, maxPos: number) {
  const minMs = minPos <= 0 ? 0 : posToMs(minPos);
  const maxMs = maxPos >= DATE_SLIDER_MAX ? Infinity : posToMs(maxPos);
  lastModifiedDateRange.value = [minMs, maxMs];
}

const nameFilters: ("named" | "unnamed")[] = ["named", "unnamed"];

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

function tagStyle(tag: ProjectTag): Record<string, string> {
  if (selectedProjectTags.value.includes(tag.slug)) {
    return { backgroundColor: tag.color, color: tag.textColor, borderColor: tag.color };
  }
  if (theme.value === "dark") {
    return { backgroundColor: tag.color + "28", color: tag.textColor, borderColor: tag.color };
  }
  return { backgroundColor: "transparent", color: tag.color, borderColor: tag.color };
}

const allTags = PROJECT_TAGS.filter((tag) => !tag.hidden);
const tagGroups: { key: string; hintKey?: string; tags: ProjectTag[] }[] = [
  { key: "line", tags: allTags.filter((tag) => !BUILDING_CATEGORY_TAGS.has(tag.slug)) },
  {
    key: "building",
    hintKey: "map.controls.buildingTagsHint",
    tags: allTags.filter((tag) => BUILDING_CATEGORY_TAGS.has(tag.slug)),
  },
];
const untaggedFilter = UNTAGGED_PROJECT_FILTER;
</script>
