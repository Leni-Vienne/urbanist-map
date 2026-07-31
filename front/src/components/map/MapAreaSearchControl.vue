<template>
  <Button
    v-if="showControl"
    class="max-w-full"
    :label="buttonLabel"
    :aria-label="buttonLabel"
    :icon="buttonIcon"
    size="small"
    raised
    :disabled="!canSearch || isLoading"
    v-tooltip.bottom="tooltip ?? null"
    @click="searchCurrentArea"
  />
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { LngLatBounds, type Map as MaplibreMap } from "maplibre-gl";
import { useI18n } from "vue-i18n";
import { onMapReady } from "@/services/core/map";
import { getMobileDrawerOcclusionPx } from "@/services/core/mapNavigation";
import { useUiStore } from "@/stores/uiStore";
import { isLoading, mapArea, setMapArea, type MapArea } from "@/services/feed/latestContributions";

// Widest filter worth applying, in degrees of longitude. Gating on the ground the view spans rather
// than on a zoom level keeps the threshold the same everywhere: a phone covers far less at a given
// zoom than a desktop map does, and would otherwise have to zoom in much further to earn the filter.
const MAX_SEARCH_SPAN_DEGREES = 25;
const BOUNDS_PRECISION = 1e-4;

const { t } = useI18n();
const uiStore = useUiStore();
const currentArea = ref<MapArea | null>(null);
const currentSpan = ref(360);

const canSearch = computed(
  () => currentArea.value !== null && currentSpan.value <= MAX_SEARCH_SPAN_DEGREES,
);
const hasChangedArea = computed(() => !sameArea(currentArea.value, mapArea.value));
const showControl = computed(() => mapArea.value === null || hasChangedArea.value);
const buttonLabel = computed(() =>
  mapArea.value && hasChangedArea.value
    ? t("contribution.updateMapArea")
    : t("contribution.searchMapArea"),
);
const buttonIcon = computed(() =>
  mapArea.value && hasChangedArea.value ? "pi pi-refresh" : "pi pi-search",
);
const tooltip = computed(() =>
  canSearch.value ? undefined : t("contribution.zoomInToSearchMapArea"),
);

let listeningMap: MaplibreMap | null = null;
const stopWaitingForMap = onMapReady((target) => {
  listeningMap = target;
  updateMapArea();
  target.on("move", updateMapArea);
});

// Dragging the drawer resizes the visible map without moving the camera, so `move` alone would
// leave the captured area stale. Measured after the drawer has been laid out at its new height.
watch(() => uiStore.mobileDrawerHeightPercent, updateMapArea, { flush: "post" });

onUnmounted(() => {
  stopWaitingForMap();
  listeningMap?.off("move", updateMapArea);
  listeningMap = null;
});

function searchCurrentArea(): void {
  if (!canSearch.value || !currentArea.value) return;
  setMapArea(currentArea.value);
}

// The mobile drawer covers the bottom of the map, so the whole-container bounds reach well past
// what the user can see. Corners of the uncovered rectangle instead, keeping the diagonal pair
// MapLibre uses so a rotated view still yields the box that encloses it.
function visibleBounds(target: MaplibreMap): LngLatBounds {
  const container = target.getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight - getMobileDrawerOcclusionPx();
  if (width <= 0 || height <= 0) return target.getBounds();
  return new LngLatBounds()
    .extend(target.unproject([0, 0]))
    .extend(target.unproject([width, 0]))
    .extend(target.unproject([width, height]))
    .extend(target.unproject([0, height]));
}

function updateMapArea(): void {
  if (!listeningMap) return;
  const bounds = visibleBounds(listeningMap);
  currentArea.value = {
    west: normalizeLongitude(bounds.getWest()),
    south: bounds.getSouth(),
    east: normalizeLongitude(bounds.getEast()),
    north: bounds.getNorth(),
  };
  currentSpan.value = longitudeSpanDegrees(listeningMap);
}

// Longitude the map container spans at its current zoom. MapLibre tiles are 512px, so the whole
// world is 512 * 2^zoom pixels wide. Read from the camera rather than differencing the bounds,
// which wrap: a view encircling the globe would otherwise report a narrow span and pass the gate.
function longitudeSpanDegrees(target: MaplibreMap): number {
  const worldWidth = 512 * 2 ** target.getZoom();
  return (target.getContainer().clientWidth / worldWidth) * 360;
}

function normalizeLongitude(value: number): number {
  const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && value > 0 ? 180 : normalized;
}

function sameArea(left: MapArea | null, right: MapArea | null): boolean {
  if (!left || !right) return left === right;
  return (
    Math.abs(left.west - right.west) < BOUNDS_PRECISION &&
    Math.abs(left.south - right.south) < BOUNDS_PRECISION &&
    Math.abs(left.east - right.east) < BOUNDS_PRECISION &&
    Math.abs(left.north - right.north) < BOUNDS_PRECISION
  );
}
</script>

<style scoped>
/* Keeps a label longer than the space the toolbar can spare inside the button. */
:deep(.p-button-label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
