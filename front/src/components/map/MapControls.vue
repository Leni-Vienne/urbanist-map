<template>
  <div
    class="absolute top-[72px] left-4 z-[1000] flex flex-col gap-3 transition-opacity duration-300"
  >
    <!-- AI : Zoom Controls -->
    <div class="flex flex-col gap-1.5 mb-3">
      <Button
        @click.stop="handleZoomIn"
        @dblclick.stop
        raised
        icon="pi pi-plus"
        :aria-label="$t('controls.zoom.in')"
        v-tooltip.right="{ value: $t('controls.zoom.in'), disabled: isMobile }"
        severity="secondary"
      />
      <Button
        @click.stop="handleZoomOut"
        @dblclick.stop
        raised
        icon="pi pi-minus"
        :aria-label="$t('controls.zoom.out')"
        v-tooltip.right="{ value: $t('controls.zoom.out'), disabled: isMobile }"
        severity="secondary"
      />
      <Button
        @click.stop="showHelpModal"
        @dblclick.stop
        raised
        icon="pi pi-question"
        :aria-label="$t('controls.help')"
        v-tooltip.right="{ value: $t('controls.help'), disabled: isMobile }"
        severity="help"
      />
    </div>

    <div class="flex flex-col gap-1.5 mb-3">
      <!-- AI : Filter Control (View Mode Only) -->
      <FilterControl v-if="mode !== 'edit'" @filter-overlays="handleFilterOverlays" />
    </div>
  </div>

  <!-- AI : Help button to guide user to click markers -->
  <MarkerHelpButton />

  <!-- AI : Welcome Dialog -->
  <!-- AI : Welcome Dialog managed by UI Store -->
  <WelcomeDialog
    :modelValue="uiStore.welcomeDialogVisible"
    @update:modelValue="(val) => (uiStore.welcomeDialogVisible = val)"
  />
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import L from "leaflet";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { map } from "@/services/core/map";
import type { viewModeMarkerColor } from "@/types/index";
import FilterControl from "@/components/map/FilterControl.vue";
import MarkerHelpButton from "@/components/map/MarkerHelpButton.vue";
import WelcomeDialog from "@/components/map/WelcomeDialog.vue";

const overlayStore = useOverlayStore();
const uiStore = useUiStore();
const { isMobile } = useIsMobile();

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
  uiStore.welcomeDialogVisible = true;
}
</script>
