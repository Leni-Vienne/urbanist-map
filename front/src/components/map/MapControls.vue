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
      <!-- AI : Filter Control (View Mode Only) -->
      <FilterControl
        v-if="mode !== 'edit'"
        ref="filterControlRef"
        @filter-overlays="handleFilterOverlays"
      />
    </div>
  </div>

  <!-- AI : Welcome Dialog -->
  <!-- AI : Welcome Dialog managed by UI Store -->
  <WelcomeDialog
    :modelValue="uiStore.welcomeDialogVisible"
    @update:modelValue="(val) => (val ? uiStore.openWelcomeDialog() : uiStore.closeWelcomeDialog())"
  />
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { defineAsyncComponent, ref, watch } from "vue";
import L from "leaflet";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { map } from "@/services/core/map";
import type { viewModeMarkerColor } from "@/types/index";
import FilterControl from "@/components/map/FilterControl.vue";

const WelcomeDialog = defineAsyncComponent(() => import("@/components/map/WelcomeDialog.vue"));

const overlayStore = useOverlayStore();

const uiStore = useUiStore();

// AI : Refs for popovers
const layerControlRef = ref();
const filterControlRef = ref();

// AI : Watch for layer panel visibility changes and close filter panel if needed
watch(
  () => layerControlRef.value?.layerPanel?.visible,
  (isVisible) => {
    if (isVisible && filterControlRef.value?.filterPanel?.visible) {
      filterControlRef.value.filterPanel.hide();
    }
  },
);

// AI : Watch for filter panel visibility changes and close layer panel if needed
watch(
  () => filterControlRef.value?.filterPanel?.visible,
  (isVisible) => {
    if (isVisible && layerControlRef.value?.layerPanel?.visible) {
      layerControlRef.value.layerPanel.hide();
    }
  },
);

const { mode } = storeToRefs(overlayStore);

// AI : Emit events to parent for complex operations that require access to map state
const emit = defineEmits<{
  "filter-overlays": [status: viewModeMarkerColor];
}>();

// AI : Handle filter overlays event from FilterControl
function handleFilterOverlays(status: viewModeMarkerColor) {
  emit("filter-overlays", status);
}

// AI : Helper to zoom with mobile offset - keeps focus on upper visible area
function zoomWithMobileOffset(zoomDelta: number) {
  const isMobile = globalThis.innerWidth <= 768;
  const shouldOffset = isMobile && uiStore.mobileDrawerVisible;

  if (!shouldOffset) {
    // AI : Desktop or drawer closed - use normal zoom with larger delta on mobile
    if (zoomDelta > 0) {
      map.value.zoomIn(isMobile ? 1 : undefined);
    } else {
      map.value.zoomOut(isMobile ? 1 : undefined);
    }
    return;
  }

  // AI : Mobile with drawer open - zoom but shift center to keep visible area stable
  // AI : Strategy: Calculate where the "visual center" (accounting for drawer) currently is,
  // AI : then zoom to that point so it stays in the same visible position

  // AI : The visual center is at 27.5% from top (middle of the 55% visible area)
  const visualCenterY = globalThis.innerHeight * 0.275;
  const screenCenterX = globalThis.innerWidth / 2;

  // AI : Get the lat/lng at the visual center point
  const visualCenterPoint = L.point(screenCenterX, visualCenterY);
  const visualCenterLatLng = map.value.containerPointToLatLng(visualCenterPoint);

  // AI : Now zoom to that lat/lng - when it centers on this point,
  // AI : that point will be at screen center, but since our "visual center" was already
  // AI : accounting for the drawer, the visible content stays stable
  const newZoom = map.value.getZoom() + (zoomDelta > 0 ? 1 : -1);
  map.value.setZoomAround(visualCenterLatLng, newZoom, { animate: true });
}

// AI : Handle zoom in
function handleZoomIn() {
  zoomWithMobileOffset(1);
}

// AI : Handle zoom out
function handleZoomOut() {
  zoomWithMobileOffset(-1);
}

// AI : Show help modal
function showHelpModal() {
  uiStore.openWelcomeDialog();
}
</script>

<style scoped>
.map-buttons {
  position: absolute;
  top: 72px;
  /* AI : Moved down to make room for city search (16px + 40px search + 16px gap) */
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
</style>
