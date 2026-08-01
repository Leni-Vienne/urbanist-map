<template>
  <h3 v-if="showHeading" class="m-0 mb-3 text-[0.95rem] font-semibold text-color">
    {{ $t("map.controls.filterByStatusAndTags") }}
  </h3>

  <p class="m-0 mb-1.5 text-xs font-semibold text-color-secondary uppercase tracking-wide">
    {{ $t("map.controls.filterByArea") }}
  </p>
  <div class="flex flex-col gap-1 mb-4">
    <label
      class="flex items-center gap-2 text-sm text-color"
      :class="canPickArea ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'"
    >
      <Checkbox
        :model-value="isAreaFiltered"
        :binary="true"
        :disabled="!canPickArea"
        @update:model-value="toggleMapAreaFilter"
      />
      {{ $t("map.controls.onlyVisibleArea") }}
    </label>
    <p v-if="!canPickArea" class="m-0 text-[0.7rem] italic text-color-secondary">
      {{ $t("map.controls.zoomInToFilterArea") }}
    </p>
  </div>

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
      <Checkbox
        :model-value="showOnlyWithImages"
        :binary="true"
        @update:model-value="toggleShowOnlyWithImages"
      />
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
      <Checkbox
        :model-value="selectedStatusFilters.includes(timelineStatus)"
        :binary="true"
        @update:model-value="toggleFilter(timelineStatus)"
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
      <Checkbox
        :model-value="selectedNameFilters.includes(nameVal)"
        :binary="true"
        @update:model-value="toggleNameFilter(nameVal)"
      />
      {{ $t(`map.controls.${nameVal}`) }}
    </label>
    <label class="flex items-center gap-2 cursor-pointer text-sm text-color">
      <Checkbox
        :model-value="selectedProjectTags.includes(untaggedFilter)"
        :binary="true"
        @update:model-value="toggleProjectTagFilter(untaggedFilter)"
      />
      {{ $t("map.controls.untagged") }}
    </label>
  </div>

  <div class="mb-4">
    <p class="m-0 mb-2 text-xs font-semibold text-color-secondary uppercase tracking-wide">
      {{ $t("map.controls.filterBySize") }}
    </p>
    <!-- The horizontal padding holds the handles, which overhang the track ends by half their width -->
    <div class="px-2.5">
      <!-- @vue-expect-error PrimeVue v-model type mismatch -->
      <Slider v-model="sizeSliderPositions" :min="0" :max="100" :step="1" range class="w-full" />
      <div class="flex justify-between mt-2 text-xs text-color-secondary">
        <span>{{ formatSizeM(sizeFilterRange[0]) }}</span>
        <span>{{ formatSizeM(sizeFilterRange[1]) }}</span>
      </div>
    </div>
  </div>

  <div>
    <p class="m-0 mb-2 text-xs font-semibold text-color-secondary uppercase tracking-wide">
      {{ $t("map.controls.filterByLastModified") }}
    </p>
    <div class="px-2.5">
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
import { ref, computed, onUnmounted } from "vue";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useI18n } from "vue-i18n";
import { onMapReady } from "@/services/core/map";
import { canFilterVisibleArea, getVisibleMapArea } from "@/services/map/visibleMapArea";
import { clearMapArea, mapArea, setMapArea } from "@/services/feed/latestContributions";
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
  showOnlyWithImages,
  toggleShowOnlyWithImages,
  formatSizeM,
  sizeSliderPositions,
  dateSliderPositions,
  DATE_SLIDER_MAX,
  posToDaysAgo,
  posToMs,
} from "@/services/core/filters";
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

// The area is captured when the box is ticked and then held, so panning away never rewrites it.
const canFilterArea = ref(false);
const isAreaFiltered = computed(() => mapArea.value !== null);
const canPickArea = computed(() => canFilterArea.value || isAreaFiltered.value);

let listeningMap: MaplibreMap | null = null;
const stopWaitingForMap = onMapReady(trackVisibleArea);

onUnmounted(releaseVisibleArea);

function releaseVisibleArea(): void {
  stopWaitingForMap();
  listeningMap?.off("move", refreshAreaGate);
  listeningMap = null;
}

function trackVisibleArea(target: MaplibreMap): void {
  listeningMap = target;
  refreshAreaGate();
  target.on("move", refreshAreaGate);
}

function refreshAreaGate(): void {
  canFilterArea.value = canFilterVisibleArea();
}

function toggleMapAreaFilter(checked: boolean): void {
  if (!checked) {
    clearMapArea();
    return;
  }
  const area = getVisibleMapArea();
  if (area) setMapArea(area);
}

function formatDateSlider(pos: number): string {
  const daysAgo = Math.round(posToDaysAgo(pos));
  if (daysAgo <= 0) return t("map.controls.today");
  if (daysAgo === 1) return t("map.controls.yesterday");
  if (daysAgo < 30) return t("map.controls.daysAgo", { n: daysAgo });
  const d = new Date(posToMs(pos));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const nameFilters: ("named" | "unnamed")[] = ["named", "unnamed"];

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
