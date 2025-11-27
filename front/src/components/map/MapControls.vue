<template>
  <div class="map-buttons">
    <!-- AI : Zoom Controls -->
    <div class="buttons-stacked">
      <Button
        @click.stop="handleZoomIn"
        @dblclick.stop
        raised
        icon="pi pi-plus"
        :aria-label="$t('controls.zoom.in')"
        v-tooltip.right="$t('controls.zoom.in')"
        severity="secondary"
      />
      <Button
        @click.stop="handleZoomOut"
        @dblclick.stop
        raised
        icon="pi pi-minus"
        :aria-label="$t('controls.zoom.out')"
        v-tooltip.right="$t('controls.zoom.out')"
        severity="secondary"
      />
      <Button
        @click.stop="showHelpModal"
        @dblclick.stop
        raised
        icon="pi pi-question-circle"
        :aria-label="$t('controls.help')"
        v-tooltip.right="$t('controls.help')"
        severity="help"
      />
    </div>

    <div class="buttons-stacked">

      <LayerControl />


      <!-- AI : Filter Button (View Mode Only) - Opens Popover -->
      <Button
        v-if="mode !== 'edit'"
        @click.stop="toggleFilterPanel"
        @dblclick.stop
        raised
        icon="pi pi-filter"
        :aria-label="$t('controls.filters')"
        v-tooltip.right="$t('map.controls.filterProjects')"
        severity="secondary"
        ref="filterButton"
      />

      <!-- AI : Filter Popover (View Mode Only) -->
      <Popover
        ref="filterPanelPopoverRef"
        @click.stop
        @dblclick.stop
        appendTo="body"
      >
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
              <div
                class="marker-icon"
                v-html="createButtonSVG('yellow')"
              ></div>
              <span class="filter-label">{{ $t('map.controls.proposed') }}</span>
              <i :class="['check-icon', 'pi', visibleCompletionStates.yellow ? 'pi-check' : 'pi-times']"></i>
            </button>

            <button
              @click.stop="toggleCompletionFilter('green')"
              @dblclick.stop
              :class="['filter-button', { 'active': visibleCompletionStates.green, 'inactive': !visibleCompletionStates.green }]"
              :aria-label="$t('map.controls.togglePlanned')"
              :aria-pressed="visibleCompletionStates.green"
              type="button"
            >
              <div
                class="marker-icon"
                v-html="createButtonSVG('green')"
              ></div>
              <span class="filter-label">{{ $t('map.controls.planned') }}</span>
              <i :class="['check-icon', 'pi', visibleCompletionStates.green ? 'pi-check' : 'pi-times']"></i>
            </button>

            <button
              @click.stop="toggleCompletionFilter('orange')"
              @dblclick.stop
              :class="['filter-button', { 'active': visibleCompletionStates.orange, 'inactive': !visibleCompletionStates.orange }]"
              :aria-label="$t('map.controls.toggleInProgress')"
              :aria-pressed="visibleCompletionStates.orange"
              type="button"
            >
              <div
                class="marker-icon"
                v-html="createButtonSVG('orange')"
              ></div>
              <span class="filter-label">{{ $t('map.controls.inProgress') }}</span>
              <i :class="['check-icon', 'pi', visibleCompletionStates.orange ? 'pi-check' : 'pi-times']"></i>
            </button>

            <button
              @click.stop="toggleCompletionFilter('grey')"
              @dblclick.stop
              :class="['filter-button', { 'active': visibleCompletionStates.grey, 'inactive': !visibleCompletionStates.grey }]"
              :aria-label="$t('map.controls.toggleCompleted')"
              :aria-pressed="visibleCompletionStates.grey"
              type="button"
            >
              <div
                class="marker-icon"
                v-html="createButtonSVG('grey')"
              ></div>
              <span class="filter-label">{{ $t('map.controls.completed') }}</span>
              <i :class="['check-icon', 'pi', visibleCompletionStates.grey ? 'pi-check' : 'pi-times']"></i>
            </button>
          </div>
        </div>
      </Popover>
    </div>
  </div>


  <!-- AI : Help Modal -->
  <MapHelpModal v-model="showHelp" />
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { defineAsyncComponent, ref } from 'vue';
import L from 'leaflet';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import { useUiStore } from '@stores/uiStore';
import { useCompletionFilters } from '@composables/overlay/useCompletionFilters';
import { createButtonSVG } from '@composables/map/useMarkers';
import { map } from '@composables/core/useMap';
import type { viewModeMarkerColor } from '@types';

const LayerControl = defineAsyncComponent(() => import('@components/map/LayerControl.vue'));
const MapHelpModal = defineAsyncComponent(() => import('@components/map/MapHelpModal.vue'));

const overlayStore = useOverlayStore();

// AI : Help modal state
const showHelp = ref(false);

// AI : Filter panel ref and toggle
const filterPanelPopoverRef = ref();

function toggleFilterPanel(event: Event) {
  filterPanelPopoverRef.value?.toggle(event);
}

const { mode } = storeToRefs(overlayStore);
const { visibleCompletionStates, toggleFilter } = useCompletionFilters();

// AI : Emit events to parent for complex operations that require access to map state
const emit = defineEmits<{
  'filter-overlays': [status: viewModeMarkerColor];
}>();

// AI : Toggle completion status filter
async function toggleCompletionFilter(color: viewModeMarkerColor) {
  toggleFilter(color);
  emit('filter-overlays', color);
}

// AI : Helper to zoom with mobile offset - keeps focus on upper visible area
function zoomWithMobileOffset(zoomDelta: number) {
  if (!map.value) return

  const isMobile = window.innerWidth <= 768
  const uiStore = useUiStore()
  const shouldOffset = isMobile && uiStore.mobileDrawerVisible

  if (!shouldOffset) {
    // AI : Desktop or drawer closed - use normal zoom with larger delta on mobile
    if (zoomDelta > 0) {
      map.value.zoomIn(isMobile ? 1.0 : undefined)
    } else {
      map.value.zoomOut(isMobile ? 1.0 : undefined)
    }
    return
  }

  // AI : Mobile with drawer open - zoom but shift center to keep visible area stable
  // AI : Strategy: Calculate where the "visual center" (accounting for drawer) currently is,
  // AI : then zoom to that point so it stays in the same visible position

  // AI : The visual center is at 27.5% from top (middle of the 55% visible area)
  const visualCenterY = window.innerHeight * 0.275
  const screenCenterX = window.innerWidth / 2

  // AI : Get the lat/lng at the visual center point
  const visualCenterPoint = L.point(screenCenterX, visualCenterY)
  const visualCenterLatLng = map.value.containerPointToLatLng(visualCenterPoint)

  // AI : Now zoom to that lat/lng - when it centers on this point,
  // AI : that point will be at screen center, but since our "visual center" was already
  // AI : accounting for the drawer, the visible content stays stable
  const newZoom = map.value.getZoom() + (zoomDelta > 0 ? 1 : -1)
  map.value.setZoomAround(visualCenterLatLng, newZoom, { animate: true })
}

// AI : Handle zoom in
function handleZoomIn() {
  zoomWithMobileOffset(1)
}

// AI : Handle zoom out  
function handleZoomOut() {
  zoomWithMobileOffset(-1)
}

// AI : Show help modal
function showHelpModal() {
  showHelp.value = true;
}
</script>

<style scoped>
.map-buttons {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 1000;
  /* important on mobile */
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: opacity 0.3s ease;
}

/* AI : Overlay completion status filter buttons */
.buttons-stacked {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

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
