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
      <div class="flex flex-col gap-2">
        <ToggleButton
          v-for="{ color, labelKey, ariaKey } in filters"
          :key="color"
          :modelValue="visibleStates[color]"
          @update:modelValue="toggleCompletionFilter(color)"
          @click.stop
          @dblclick.stop
          :aria-label="$t(ariaKey)"
          class="w-full justify-start"
        >
          <template #default>
            <div
              class="marker-icon flex items-center justify-center shrink-0 w-6 h-6"
              v-html="createButtonSVG(color)"
            ></div>
            <span class="flex-1 text-left">{{ $t(labelKey) }}</span>
            <i
              :class="[
                'pi',
                visibleStates[color] ? 'pi-check' : 'pi-times',
                'shrink-0 text-base ml-auto',
              ]"
            ></i>
          </template>
        </ToggleButton>
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
  visibleStates,
  selectedProjectTags,
  toggleFilter,
  toggleProjectTagFilter,
  UNTAGGED_PROJECT_FILTER,
} from "@/services/overlay/statusFilters";
import { createButtonSVG } from "@/services/map/markers";
import type { viewModeMarkerColor } from "@/types/index";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import { PROJECT_TAGS } from "@/config/projectTags";

const filters: { color: viewModeMarkerColor; labelKey: string; ariaKey: string }[] = [
  { color: "yellow", labelKey: "map.controls.proposed", ariaKey: "map.controls.toggleProposed" },
  { color: "blue", labelKey: "map.controls.planned", ariaKey: "map.controls.togglePlanned" },
  {
    color: "orange",
    labelKey: "map.controls.inProgress",
    ariaKey: "map.controls.toggleInProgress",
  },
  { color: "green", labelKey: "status.completed", ariaKey: "map.controls.toggleCompleted" },
];

const { isMobile } = useIsMobile();
const allTags = PROJECT_TAGS;
const untaggedFilter = UNTAGGED_PROJECT_FILTER;

// Panel visibility state
const showFilterPanel = ref(false);

// Ref for the popover
const filterPanel = ref();

// Completion filters composable

// Emit events to parent for complex operations
const emit = defineEmits<{
  "filter-overlays": [];
}>();

// Toggle filter panel visibility
function toggleFilterPanel(event: Event) {
  filterPanel.value.toggle(event);
  showFilterPanel.value = !showFilterPanel.value;
}

// Toggle completion status filter
async function toggleCompletionFilter(color: viewModeMarkerColor) {
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

<style scoped>
/* Keep deep selector for SVG inside v-html rendered marker icons */
.marker-icon :deep(svg) {
  width: 24px;
  height: 24px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
}
</style>
