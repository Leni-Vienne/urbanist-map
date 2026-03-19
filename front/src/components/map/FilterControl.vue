<template>
  <!-- Filter Button (View Mode Only) - Opens Popover -->
  <Button
    ref="filterButton"
    @click.stop="toggleFilterPanel"
    @dblclick.stop
    raised
    icon="pi pi-filter"
    :aria-label="$t('controls.filters')"
    v-tooltip.right="{
      value: $t('map.controls.filterProjects'),
      disabled: isMobile,
    }"
    :severity="showFilterPanel ? undefined : 'secondary'"
  />

  <!-- Filter Popover (View Mode Only) -->
  <Popover ref="filterPanel" @click.stop @dblclick.stop appendTo="body">
    <div class="p-2 min-w-55">
      <h3 class="m-0 mb-3 text-[0.95rem] font-semibold text-color">
        {{ $t("map.controls.filterByStatus") }}
      </h3>
      <div class="flex flex-wrap gap-2 max-w-70">
        <button
          v-for="{ color, labelKey, ariaKey } in filters"
          :key="color"
          type="button"
          class="px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition-all duration-150 cursor-pointer flex items-center gap-1.5"
          :aria-pressed="selectedStatusFilters.includes(color)"
          :style="getStatusButtonStyle(color)"
          @click.stop="toggleCompletionFilter(color)"
          @dblclick.stop
          :aria-label="$t(ariaKey)"
        >
          <span
            class="w-3 h-3 rounded-full shrink-0"
            :style="{ backgroundColor: markerColors[color] }"
          ></span>
          <span>{{ $t(labelKey) }}</span>
        </button>
      </div>

      <div class="mt-4">
        <h3 class="m-0 mb-3 text-[0.95rem] font-semibold text-color">
          {{ $t("map.controls.filterByTags") }}
        </h3>
        <div class="flex flex-wrap gap-2 max-w-70">
          <button
            type="button"
            class="px-3 py-1 rounded-full text-xs font-semibold border-2 transition-all duration-150 cursor-pointer"
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
            v-for="tag in allTags"
            :key="tag.slug"
            type="button"
            class="px-3 py-1 rounded-full text-xs font-semibold border-2 transition-all duration-150 cursor-pointer"
            :aria-pressed="selectedProjectTags.includes(tag.slug)"
            :style="
              selectedProjectTags.includes(tag.slug)
                ? { backgroundColor: tag.color, color: tag.textColor, borderColor: tag.color }
                : { backgroundColor: 'transparent', color: tag.color, borderColor: tag.color }
            "
            @click.stop="toggleTagFilter(tag.slug)"
            @dblclick.stop
          >
            {{ $te(`tags.${tag.slug}`) ? $t(`tags.${tag.slug}`) : tag.slug }}
          </button>
        </div>
      </div>
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import {
  selectedStatusFilters,
  selectedProjectTags,
  toggleFilter,
  toggleProjectTagFilter,
  UNTAGGED_PROJECT_FILTER,
} from "@/services/overlay/statusFilters";
import { markerColors } from "@/services/map/markers";
import type { viewModeMarkerColor } from "@/types/index";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import { PROJECT_TAGS } from "@/config/projectTags";

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
const allTags = PROJECT_TAGS;
const untaggedFilter = UNTAGGED_PROJECT_FILTER;

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
