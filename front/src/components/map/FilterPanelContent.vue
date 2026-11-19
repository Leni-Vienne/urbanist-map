<template>
  <div
    class="sticky top-0 z-10 mb-3 flex h-9 items-center gap-2 border-b border-(--p-content-border-color) bg-content-background"
  >
    <h3 v-if="showHeading" class="m-0 shrink-0 text-[0.95rem] font-semibold text-color">
      {{ $t("map.controls.filterByStatusAndTags") }}
    </h3>
    <p class="m-0 min-w-0 truncate text-sm text-muted-color tabular-nums" role="status">
      <span v-if="showHeading && projectCountLabel" class="me-1" aria-hidden="true">·</span
      >{{ projectCountLabel }}
    </p>
  </div>

  <div class="flex flex-col gap-2 mb-4">
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
    <p v-if="!canPickArea" class="m-0 -mt-1 ps-7 text-xs text-muted-color">
      {{ $t("map.controls.zoomInToFilterArea") }}
    </p>
    <label class="flex items-center gap-2 cursor-pointer text-sm text-color">
      <Checkbox
        :model-value="showOnlyWithImages"
        :binary="true"
        @update:model-value="toggleShowOnlyWithImages"
      />
      {{ $t("map.controls.onlyWithImages") }}
    </label>
  </div>

  <div class="flex items-center justify-between mb-1.5">
    <p class="m-0 text-xs font-semibold text-(--p-text-color-secondary) uppercase tracking-wide">
      {{ $t("map.controls.filterByTags") }}
    </p>
    <button
      v-if="selectedProjectTags.filter((slug) => slug !== untaggedFilter).length > 0"
      type="button"
      class="text-xs text-(--p-text-color-secondary) underline cursor-pointer bg-transparent border-0 p-0"
      @click="clearProjectTagFilters"
      @dblclick.stop
    >
      {{ $t("map.controls.clearTagFilters") }}
    </button>
  </div>
  <template v-for="group in tagGroups" :key="group.key">
    <button
      v-if="group.key === 'building'"
      type="button"
      class="mb-4 flex w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-start text-sm font-medium text-color hover:bg-(--p-content-hover-background) cursor-pointer aria-expanded:mb-1.5"
      :aria-controls="buildingTagsId"
      :aria-expanded="buildingTagsOpen"
      @click="buildingTagsOpen = !buildingTagsOpen"
      @dblclick.stop
    >
      <ChevronDown
        :size="14"
        class="shrink-0"
        :class="{ '-rotate-90': !buildingTagsOpen }"
        aria-hidden="true"
      />
      {{ $t("map.controls.buildingTags") }}
    </button>
    <div
      v-show="group.key !== 'building' || buildingTagsOpen"
      :id="group.key === 'building' ? buildingTagsId : undefined"
      class="flex flex-wrap gap-1.5 mb-3"
    >
      <button
        v-for="tag in group.tags"
        :key="tag.slug"
        type="button"
        class="filter-tag"
        :aria-pressed="selectedProjectTags.includes(tag.slug)"
        :style="{ '--tag-color': tag.color }"
        @click="toggleProjectTagFilter(tag.slug)"
        @dblclick.stop
      >
        <span class="grid size-3 shrink-0 place-items-center" aria-hidden="true">
          <Check v-if="selectedProjectTags.includes(tag.slug)" :size="12" />
          <span v-else class="size-2 rounded-full bg-(--tag-color)" />
        </span>
        {{ $te(`tags.${tag.slug}`) ? $t(`tags.${tag.slug}`) : tag.slug }}
      </button>
    </div>
  </template>

  <div class="mb-4">
    <p
      class="m-0 mb-2 text-xs font-semibold text-(--p-text-color-secondary) uppercase tracking-wide"
    >
      {{ $t("map.controls.filterBySize") }}
    </p>
    <!-- The horizontal padding holds the handles, which overhang the track ends by half their width -->
    <div class="px-2.5">
      <!-- @vue-expect-error PrimeVue v-model type mismatch -->
      <Slider v-model="sizeSliderPositions" :min="0" :max="100" :step="1" range class="w-full" />
      <div class="flex justify-between mt-2 text-xs text-(--p-text-color-secondary)">
        <span>{{ formatSizeM(sizeFilterRange[0]) }}</span>
        <span>{{ formatSizeM(sizeFilterRange[1]) }}</span>
      </div>
    </div>
  </div>

  <p class="m-0 mb-2 text-xs font-semibold text-(--p-text-color-secondary) uppercase tracking-wide">
    {{ $t("map.controls.filterByLastModified") }}
  </p>
  <div class="mb-4 px-2.5">
    <!-- @vue-expect-error PrimeVue v-model type mismatch -->
    <Slider
      v-model="dateSliderPositions"
      :min="0"
      :max="DATE_SLIDER_MAX"
      :step="1"
      range
      class="w-full"
    />
    <div class="flex justify-between mt-2 text-xs text-(--p-text-color-secondary)">
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

  <p
    class="m-0 mb-1.5 text-xs font-semibold text-(--p-text-color-secondary) uppercase tracking-wide"
  >
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

  <p
    class="m-0 mb-1.5 text-xs font-semibold text-(--p-text-color-secondary) uppercase tracking-wide"
  >
    {{ $t("map.controls.filterByName") }}
  </p>
  <div class="flex flex-col gap-1">
    <label
      v-for="nameVal in nameFilters"
      :key="nameVal"
      class="flex items-center gap-2 cursor-pointer text-sm text-color"
    >
      <Checkbox
        :model-value="selectedNameFilter === nameVal"
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
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, useId, watch } from "vue";
import Check from "@lucide/vue/dist/esm/icons/check.mjs";
import ChevronDown from "@lucide/vue/dist/esm/icons/chevron-down.mjs";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useI18n } from "vue-i18n";
import { onMapReady } from "@/services/core/map";
import { canFilterVisibleArea, getVisibleMapArea } from "@/services/map/visibleMapArea";
import { storeToRefs } from "pinia";
import { useLatestContributionsStore } from "@/stores/latestContributionsStore";
import {
  selectedStatusFilters,
  selectedProjectTags,
  toggleFilter,
  toggleProjectTagFilter,
  clearProjectTagFilters,
  UNTAGGED_PROJECT_FILTER,
  sizeFilterRange,
  selectedNameFilter,
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
import type { TimelineStatus } from "@shared/types/project";
import { PROJECT_TAGS, PROJECT_TAG_MAP, AREAL_PROJECT_TAGS } from "@/constants/projectTags";
import { markFiltersSeen } from "@/services/core/settings";
import LinePreview from "@/components/common/LinePreview.vue";

const feedStore = useLatestContributionsStore();
const { mapArea, projectCount, hasCountError } = storeToRefs(feedStore);
const { clearMapArea, setMapArea } = feedStore;

withDefaults(defineProps<{ showHeading?: boolean }>(), { showHeading: true });

markFiltersSeen();

const { t, n } = useI18n();
const projectCountLabel = computed(formatProjectCount);
feedStore.observeContributionCount();

function formatProjectCount(): string {
  if (hasCountError.value) return t("contribution.projectCountUnavailable");
  const count = projectCount.value;
  return count === null ? "" : t("contribution.matchingProjectCount", { count: n(count) }, count);
}

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
  { timelineStatus: "completed", labelKey: "timelineStatus.completed" },
];

// Use the active tag color for line previews when exactly one tag is selected.
const linePreviewColor = computed(() => {
  const tagSlugs = selectedProjectTags.value.filter((slug) => slug !== UNTAGGED_PROJECT_FILTER);
  if (tagSlugs.length === 1) {
    return PROJECT_TAG_MAP.get(tagSlugs[0] ?? "")?.color ?? "#6b7280";
  }
  return "#6b7280";
});

const allTags = PROJECT_TAGS.filter((tag) => !tag.hidden);
const tagGroups = [
  { key: "line", tags: allTags.filter((tag) => !AREAL_PROJECT_TAGS.has(tag.slug)) },
  { key: "building", tags: allTags.filter((tag) => AREAL_PROJECT_TAGS.has(tag.slug)) },
];
const untaggedFilter = UNTAGGED_PROJECT_FILTER;

const buildingTagsId = useId();
const buildingTagsOpen = ref(false);
const hasSelectedBuildingTag = computed(() =>
  selectedProjectTags.value.some((slug) => AREAL_PROJECT_TAGS.has(slug)),
);
watch(hasSelectedBuildingTag, revealSelectedBuildings, { immediate: true });

function revealSelectedBuildings(selected: boolean): void {
  if (selected) buildingTagsOpen.value = true;
}
</script>

<style scoped>
.filter-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 2rem;
  padding: 0.25rem 0.375rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 9999px;
  background: var(--p-content-background);
  color: var(--p-text-color);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
}

.filter-tag:hover {
  background: var(--p-content-hover-background);
}

.filter-tag[aria-pressed="true"] {
  border-color: var(--tag-color);
  background: color-mix(in srgb, var(--tag-color) 25%, var(--p-content-background));
}
</style>
