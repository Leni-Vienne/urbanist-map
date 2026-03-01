<template>
  <!-- AI : Filter Button (View Mode Only) - Opens Popover -->
  <Button
    ref="filterButton"
    @click.stop="toggleFilterPanel"
    @dblclick.stop
    raised
    icon="pi pi-filter"
    :aria-label="$t('controls.filters')"
    v-tooltip.right="$t('map.controls.filterProjects')"
    :severity="showFilterPanel ? undefined : 'secondary'"
  />

  <!-- AI : Filter Popover (View Mode Only) -->
  <Popover ref="filterPanel" @click.stop @dblclick.stop appendTo="body">
    <div class="p-2 min-w-[220px]">
      <h3 class="m-0 mb-3 text-[0.95rem] font-semibold text-[var(--p-text-color)]">
        {{ $t("map.controls.filterByStatus") }}
      </h3>
      <div class="flex flex-col gap-2">
        <button
          @click.stop="toggleCompletionFilter('yellow')"
          @dblclick.stop
          class="appearance-none font-[inherit] flex items-center gap-[10px] w-full px-3 py-[0.65rem] border-2 rounded-xl cursor-pointer transition-all duration-150 text-[0.9rem] font-medium text-left hover:translate-x-0.5 active:scale-[0.98] focus:outline-none"
          :class="
            visibleCompletionStates.yellow
              ? 'bg-[var(--p-primary-color)] border-[var(--p-primary-color)] text-[var(--p-primary-contrast-color)] shadow-sm hover:bg-[var(--p-primary-hover-color)] hover:border-[var(--p-primary-hover-color)]'
              : 'bg-[var(--p-surface-100)] border-[var(--p-surface-300)] text-[var(--p-text-color)] opacity-60 hover:opacity-80 hover:border-[var(--p-surface-400)]'
          "
          :aria-label="$t('map.controls.toggleProposed')"
          :aria-pressed="visibleCompletionStates.yellow"
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
              visibleCompletionStates.yellow ? 'pi-check' : 'pi-times',
              'shrink-0 text-base ml-auto transition-all duration-150',
            ]"
          ></i>
        </button>

        <button
          @click.stop="toggleCompletionFilter('green')"
          @dblclick.stop
          class="appearance-none font-[inherit] flex items-center gap-[10px] w-full px-3 py-[0.65rem] border-2 rounded-xl cursor-pointer transition-all duration-150 text-[0.9rem] font-medium text-left hover:translate-x-0.5 active:scale-[0.98] focus:outline-none"
          :class="
            visibleCompletionStates.green
              ? 'bg-[var(--p-primary-color)] border-[var(--p-primary-color)] text-[var(--p-primary-contrast-color)] shadow-sm hover:bg-[var(--p-primary-hover-color)] hover:border-[var(--p-primary-hover-color)]'
              : 'bg-[var(--p-surface-100)] border-[var(--p-surface-300)] text-[var(--p-text-color)] opacity-60 hover:opacity-80 hover:border-[var(--p-surface-400)]'
          "
          :aria-label="$t('map.controls.togglePlanned')"
          :aria-pressed="visibleCompletionStates.green"
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
              visibleCompletionStates.green ? 'pi-check' : 'pi-times',
              'shrink-0 text-base ml-auto transition-all duration-150',
            ]"
          ></i>
        </button>

        <button
          @click.stop="toggleCompletionFilter('orange')"
          @dblclick.stop
          class="appearance-none font-[inherit] flex items-center gap-[10px] w-full px-3 py-[0.65rem] border-2 rounded-xl cursor-pointer transition-all duration-150 text-[0.9rem] font-medium text-left hover:translate-x-0.5 active:scale-[0.98] focus:outline-none"
          :class="
            visibleCompletionStates.orange
              ? 'bg-[var(--p-primary-color)] border-[var(--p-primary-color)] text-[var(--p-primary-contrast-color)] shadow-sm hover:bg-[var(--p-primary-hover-color)] hover:border-[var(--p-primary-hover-color)]'
              : 'bg-[var(--p-surface-100)] border-[var(--p-surface-300)] text-[var(--p-text-color)] opacity-60 hover:opacity-80 hover:border-[var(--p-surface-400)]'
          "
          :aria-label="$t('map.controls.toggleInProgress')"
          :aria-pressed="visibleCompletionStates.orange"
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
              visibleCompletionStates.orange ? 'pi-check' : 'pi-times',
              'shrink-0 text-base ml-auto transition-all duration-150',
            ]"
          ></i>
        </button>

        <button
          @click.stop="toggleCompletionFilter('grey')"
          @dblclick.stop
          class="appearance-none font-[inherit] flex items-center gap-[10px] w-full px-3 py-[0.65rem] border-2 rounded-xl cursor-pointer transition-all duration-150 text-[0.9rem] font-medium text-left hover:translate-x-0.5 active:scale-[0.98] focus:outline-none"
          :class="
            visibleCompletionStates.grey
              ? 'bg-[var(--p-primary-color)] border-[var(--p-primary-color)] text-[var(--p-primary-contrast-color)] shadow-sm hover:bg-[var(--p-primary-hover-color)] hover:border-[var(--p-primary-hover-color)]'
              : 'bg-[var(--p-surface-100)] border-[var(--p-surface-300)] text-[var(--p-text-color)] opacity-60 hover:opacity-80 hover:border-[var(--p-surface-400)]'
          "
          :aria-label="$t('map.controls.toggleCompleted')"
          :aria-pressed="visibleCompletionStates.grey"
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
              visibleCompletionStates.grey ? 'pi-check' : 'pi-times',
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
import { visibleCompletionStates, toggleFilter } from "@/services/overlay/completionFilters";
import { createButtonSVG } from "@/services/map/markers";
import type { viewModeMarkerColor } from "@/types/index";

// AI : Panel visibility state
const showFilterPanel = ref(false);

// AI : Ref for the popover
const filterPanel = ref();

// AI : Completion filters composable

// AI : Emit events to parent for complex operations
const emit = defineEmits<{
  "filter-overlays": [status: viewModeMarkerColor];
}>();

// AI : Toggle filter panel visibility
function toggleFilterPanel(event: Event) {
  filterPanel.value.toggle(event);
  showFilterPanel.value = !showFilterPanel.value;
}

// AI : Toggle completion status filter
async function toggleCompletionFilter(color: viewModeMarkerColor) {
  toggleFilter(color);
  emit("filter-overlays", color);
}

// AI : Watch for popover visibility changes
watch(
  () => filterPanel.value?.visible,
  (visible) => {
    showFilterPanel.value = visible ?? false;
  },
);

// AI : Expose the filter panel ref so parent can close it when needed
defineExpose({
  filterPanel,
});
</script>

<style scoped>
/* AI : Keep deep selector for SVG inside v-html rendered marker icons */
.marker-icon :deep(svg) {
  width: 24px;
  height: 24px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
}
</style>
