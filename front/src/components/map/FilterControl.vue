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
        <button
          @click.stop="toggleCompletionFilter('yellow')"
          @dblclick.stop
          class="appearance-none font-[inherit] flex items-center gap-2.5 w-full px-3 py-[0.65rem] border-2 rounded-xl cursor-pointer transition-all duration-150 text-[0.9rem] font-medium text-left hover:translate-x-0.5 active:scale-[0.98] focus:outline-none"
          :class="
            visibleStates.yellow
              ? 'bg-primary-color border-primary-color text-primary-contrast-color shadow-sm hover:bg-primary-hover-color hover:border-primary-hover-color'
              : 'bg-content-hover-background border-surface text-color opacity-60 hover:opacity-80 hover:border-surface'
          "
          :aria-label="$t('map.controls.toggleProposed')"
          :aria-pressed="visibleStates.yellow"
          type="button"
        >
          <div
            class="marker-icon flex items-center justify-center shrink-0 w-6 h-6"
            v-html="createButtonSVG('yellow')"
          ></div>
          <span class="flex-1">{{ $t("map.controls.proposed") }}</span>
          <i
            :class="[
              'pi',
              visibleStates.yellow ? 'pi-check' : 'pi-times',
              'shrink-0 text-base ml-auto transition-all duration-150',
            ]"
          ></i>
        </button>

        <button
          @click.stop="toggleCompletionFilter('green')"
          @dblclick.stop
          class="appearance-none font-[inherit] flex items-center gap-2.5 w-full px-3 py-[0.65rem] border-2 rounded-xl cursor-pointer transition-all duration-150 text-[0.9rem] font-medium text-left hover:translate-x-0.5 active:scale-[0.98] focus:outline-none"
          :class="
            visibleStates.green
              ? 'bg-primary-color border-primary-color text-primary-contrast-color shadow-sm hover:bg-primary-hover-color hover:border-primary-hover-color'
              : 'bg-content-hover-background border-surface text-color opacity-60 hover:opacity-80 hover:border-surface'
          "
          :aria-label="$t('map.controls.togglePlanned')"
          :aria-pressed="visibleStates.green"
          type="button"
        >
          <div
            class="marker-icon flex items-center justify-center shrink-0 w-6 h-6"
            v-html="createButtonSVG('green')"
          ></div>
          <span class="flex-1">{{ $t("map.controls.planned") }}</span>
          <i
            :class="[
              'pi',
              visibleStates.green ? 'pi-check' : 'pi-times',
              'shrink-0 text-base ml-auto transition-all duration-150',
            ]"
          ></i>
        </button>

        <button
          @click.stop="toggleCompletionFilter('orange')"
          @dblclick.stop
          class="appearance-none font-[inherit] flex items-center gap-2.5 w-full px-3 py-[0.65rem] border-2 rounded-xl cursor-pointer transition-all duration-150 text-[0.9rem] font-medium text-left hover:translate-x-0.5 active:scale-[0.98] focus:outline-none"
          :class="
            visibleStates.orange
              ? 'bg-primary-color border-primary-color text-primary-contrast-color shadow-sm hover:bg-primary-hover-color hover:border-primary-hover-color'
              : 'bg-content-hover-background border-surface text-color opacity-60 hover:opacity-80 hover:border-surface'
          "
          :aria-label="$t('map.controls.toggleInProgress')"
          :aria-pressed="visibleStates.orange"
          type="button"
        >
          <div
            class="marker-icon flex items-center justify-center shrink-0 w-6 h-6"
            v-html="createButtonSVG('orange')"
          ></div>
          <span class="flex-1">{{ $t("map.controls.inProgress") }}</span>
          <i
            :class="[
              'pi',
              visibleStates.orange ? 'pi-check' : 'pi-times',
              'shrink-0 text-base ml-auto transition-all duration-150',
            ]"
          ></i>
        </button>

        <button
          @click.stop="toggleCompletionFilter('grey')"
          @dblclick.stop
          class="appearance-none font-[inherit] flex items-center gap-2.5 w-full px-3 py-[0.65rem] border-2 rounded-xl cursor-pointer transition-all duration-150 text-[0.9rem] font-medium text-left hover:translate-x-0.5 active:scale-[0.98] focus:outline-none"
          :class="
            visibleStates.grey
              ? 'bg-primary-color border-primary-color text-primary-contrast-color shadow-sm hover:bg-primary-hover-color hover:border-primary-hover-color'
              : 'bg-content-hover-background border-surface text-color opacity-60 hover:opacity-80 hover:border-surface'
          "
          :aria-label="$t('map.controls.toggleCompleted')"
          :aria-pressed="visibleStates.grey"
          type="button"
        >
          <div
            class="marker-icon flex items-center justify-center shrink-0 w-6 h-6"
            v-html="createButtonSVG('grey')"
          ></div>
          <span class="flex-1">{{ $t("status.completed") }}</span>
          <i
            :class="[
              'pi',
              visibleStates.grey ? 'pi-check' : 'pi-times',
              'shrink-0 text-base ml-auto transition-all duration-150',
            ]"
          ></i>
        </button>
      </div>
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { visibleStates, toggleFilter } from "@/services/overlay/statusFilters";
import { createButtonSVG } from "@/services/map/markers";
import type { viewModeMarkerColor } from "@/types/index";
import { useIsMobile } from "@/composables/ui/useIsMobile";

const { isMobile } = useIsMobile();

// Panel visibility state
const showFilterPanel = ref(false);

// Ref for the popover
const filterPanel = ref();

// Completion filters composable

// Emit events to parent for complex operations
const emit = defineEmits<{
  "filter-overlays": [status: viewModeMarkerColor];
}>();

// Toggle filter panel visibility
function toggleFilterPanel(event: Event) {
  filterPanel.value.toggle(event);
  showFilterPanel.value = !showFilterPanel.value;
}

// Toggle completion status filter
async function toggleCompletionFilter(color: viewModeMarkerColor) {
  toggleFilter(color);
  emit("filter-overlays", color);
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
