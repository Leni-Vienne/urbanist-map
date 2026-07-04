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

  <Popover ref="filterPanel" appendTo="body" :pt="{ root: { class: 'filter-control-popover' } }">
    <!-- overflow-x hidden removes the spurious horizontal scrollbar from the sliders -->
    <div
      class="min-w-55 max-w-75 overflow-y-auto overflow-x-hidden pr-1"
      @dblclick.stop
      style="max-height: min(600px, 70svh)"
    >
      <FilterPanelContent />
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import {
  selectedStatusFilters,
  selectedProjectTags,
  sizeFilterRange,
  selectedNameFilters,
  lastModifiedDateRange,
  showOnlyWithImages,
} from "@/services/map/filters";
import { isMobile } from "@/services/core/viewport";
import FilterPanelContent from "@/components/map/FilterPanelContent.vue";

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

function toggleFilterPanel(event: Event) {
  if (showFilterHint.value) {
    showFilterHint.value = false;
    localStorage.setItem(FILTER_HINT_KEY, "1");
  }
  filterPanel.value.toggle(event);
  showFilterPanel.value = !showFilterPanel.value;
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
