<template>
  <div class="absolute top-18 left-4 z-1000 flex flex-col gap-3 transition-opacity duration-300">
    <div class="flex flex-col gap-1.5 mb-3">
      <!-- Filter Control (View Mode Only) -->
      <FilterControl v-if="mode !== 'edit'" @filter-overlays="handleFilterOverlays" />
    </div>

    <!-- Zoom Controls -->
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import L from "leaflet";
import { useIsMobile } from "@/composables/ui/useIsMobile";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { map } from "@/services/core/map";
import FilterControl from "@/components/map/FilterControl.vue";

const mapStore = useMapStore();
const uiStore = useUiStore();
const { isMobile } = useIsMobile();

const { mode } = storeToRefs(mapStore);

// Emit events to parent for complex operations that require access to map state
const emit = defineEmits<{
  "filter-overlays": [];
}>();

// Handle filter overlays event from FilterControl
function handleFilterOverlays() {
  emit("filter-overlays");
}

// Helper to zoom with mobile offset - keeps focus on upper visible area
function zoomWithMobileOffset(zoomDelta: number) {
  const shouldOffset = isMobile.value && uiStore.mobileDrawerVisible;

  if (!shouldOffset) {
    // Desktop or drawer closed - use normal zoom with larger delta on mobile
    if (zoomDelta > 0) {
      map.value.zoomIn(isMobile.value ? 1 : undefined);
    } else {
      map.value.zoomOut(isMobile.value ? 1 : undefined);
    }
    return;
  }

  // Mobile with drawer open - zoom but shift center to keep visible area stable
  // Strategy: Calculate where the "visual center" (accounting for drawer) currently is,
  // then zoom to that point so it stays in the same visible position

  // The visual center is at 27.5% from top (middle of the 55% visible area)
  const visualCenterY = globalThis.innerHeight * 0.275;
  const screenCenterX = globalThis.innerWidth / 2;

  // Get the lat/lng at the visual center point
  const visualCenterPoint = L.point(screenCenterX, visualCenterY);
  const visualCenterLatLng = map.value.containerPointToLatLng(visualCenterPoint);

  // Now zoom to that lat/lng - when it centers on this point,
  // that point will be at screen center, but since our "visual center" was already
  // accounting for the drawer, the visible content stays stable
  const newZoom = map.value.getZoom() + (zoomDelta > 0 ? 1 : -1);
  map.value.setZoomAround(visualCenterLatLng, newZoom, { animate: true });
}

// Handle zoom in
function handleZoomIn() {
  zoomWithMobileOffset(1);
}

// Handle zoom out
function handleZoomOut() {
  zoomWithMobileOffset(-1);
}
</script>
