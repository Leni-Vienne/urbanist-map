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
    <div class="filter-panel">
      <h3 class="filter-title">{{ $t('map.controls.filterByStatus') }}</h3>
      <div class="filter-buttons">
        <button
          @click.stop="toggleCompletionFilter('yellow')"
          @dblclick.stop
          :class="['filter-button', { 'active': visibleCompletionStates.yellow, 'inactive': !visibleCompletionStates.yellow }]"
          :aria-label="$t('map.controls.toggleProposed')"
          :aria-pressed="visibleCompletionStates.yellow"
          type="button"
        >
          <div class="marker-icon" v-html="createButtonSVG('yellow')"></div>
          <span class="filter-label">{{ $t('map.controls.proposed') }}</span>
          <i
            :class="['check-icon', 'pi', visibleCompletionStates.yellow ? 'pi-check' : 'pi-times']"
          ></i>
        </button>

        <button
          @click.stop="toggleCompletionFilter('green')"
          @dblclick.stop
          :class="['filter-button', { 'active': visibleCompletionStates.green, 'inactive': !visibleCompletionStates.green }]"
          :aria-label="$t('map.controls.togglePlanned')"
          :aria-pressed="visibleCompletionStates.green"
          type="button"
        >
          <div class="marker-icon" v-html="createButtonSVG('green')"></div>
          <span class="filter-label">{{ $t('map.controls.planned') }}</span>
          <i
            :class="['check-icon', 'pi', visibleCompletionStates.green ? 'pi-check' : 'pi-times']"
          ></i>
        </button>

        <button
          @click.stop="toggleCompletionFilter('orange')"
          @dblclick.stop
          :class="['filter-button', { 'active': visibleCompletionStates.orange, 'inactive': !visibleCompletionStates.orange }]"
          :aria-label="$t('map.controls.toggleInProgress')"
          :aria-pressed="visibleCompletionStates.orange"
          type="button"
        >
          <div class="marker-icon" v-html="createButtonSVG('orange')"></div>
          <span class="filter-label">{{ $t('map.controls.inProgress') }}</span>
          <i
            :class="['check-icon', 'pi', visibleCompletionStates.orange ? 'pi-check' : 'pi-times']"
          ></i>
        </button>

        <button
          @click.stop="toggleCompletionFilter('grey')"
          @dblclick.stop
          :class="['filter-button', { 'active': visibleCompletionStates.grey, 'inactive': !visibleCompletionStates.grey }]"
          :aria-label="$t('map.controls.toggleCompleted')"
          :aria-pressed="visibleCompletionStates.grey"
          type="button"
        >
          <div class="marker-icon" v-html="createButtonSVG('grey')"></div>
          <span class="filter-label">{{ $t('map.controls.completed') }}</span>
          <i
            :class="['check-icon', 'pi', visibleCompletionStates.grey ? 'pi-check' : 'pi-times']"
          ></i>
        </button>
      </div>
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useCompletionFilters } from '@/composables/overlay/useCompletionFilters';
import { createButtonSVG } from '@/composables/map/useMarkers';
import type { viewModeMarkerColor } from '@/types/index';

// AI : Panel visibility state
const showFilterPanel = ref(false);

// AI : Ref for the popover
const filterPanel = ref();

// AI : Completion filters composable
const { visibleCompletionStates, toggleFilter } = useCompletionFilters();

// AI : Emit events to parent for complex operations
const emit = defineEmits<{
    'filter-overlays': [status: viewModeMarkerColor];
}>();

// AI : Toggle filter panel visibility
function toggleFilterPanel(event: Event) {
    filterPanel.value.toggle(event);
    showFilterPanel.value = !showFilterPanel.value;
}

// AI : Toggle completion status filter
async function toggleCompletionFilter(color: viewModeMarkerColor) {
    toggleFilter(color);
    emit('filter-overlays', color);
}

// AI : Watch for popover visibility changes
watch(() => filterPanel.value?.visible, (visible) => {
    showFilterPanel.value = visible ?? false;
});

// AI : Expose the filter panel ref so parent can close it when needed
defineExpose({
    filterPanel
});
</script>

<style scoped>
/* AI : Filter panel styling */
.filter-panel {
    padding: 8px;
    min-width: 220px;
}

.filter-title {
    margin: 0 0 12px 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-color);
}

.filter-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

/* AI : Custom filter button styling */
.filter-button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 0.65rem 0.75rem;
    background: var(--surface-0);
    border: 2px solid var(--surface-border);
    border-radius: var(--border-radius);
    cursor: pointer;
    transition: all 0.15s ease-in-out;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-color);
    text-align: left;
    position: relative;
}

.filter-button:hover {
    background: var(--surface-hover);
    border-color: var(--primary-color);
    transform: translateX(2px);
}

.filter-button:active {
    transform: translateX(0px) scale(0.98);
}

.filter-button:focus {
    outline: 0 none;
    outline-offset: 0;
    box-shadow: 0 0 0 0.2rem var(--primary-color);
    border-color: var(--primary-color);
}

/* AI : Active state - filter is ON */
.filter-button.active {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: var(--primary-color-text);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.filter-button.active:hover {
    background: var(--primary-hover-color);
    border-color: var(--primary-hover-color);
}

/* AI : Inactive state - filter is OFF */
.filter-button.inactive {
    background: var(--surface-100);
    border-color: var(--surface-300);
    opacity: 0.6;
}

.filter-button.inactive:hover {
    opacity: 0.8;
    border-color: var(--surface-400);
}

.marker-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
}

.marker-icon :deep(svg) {
    width: 24px;
    height: 24px;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
}

.filter-label {
    flex: 1;
}

.check-icon {
    flex-shrink: 0;
    font-size: 1rem;
    margin-left: auto;
    transition: all 0.15s ease-in-out;
}

.filter-button.active .check-icon {
    color: var(--primary-color-text);
}

.filter-button.inactive .check-icon {
    color: var(--text-color-secondary);
}
</style>
