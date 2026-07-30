<template>
  <Button
    v-if="showControl"
    :label="buttonLabel"
    :aria-label="buttonLabel"
    :icon="buttonIcon"
    size="small"
    raised
    :disabled="!canSearch || isLoading"
    v-tooltip.bottom="tooltip ?? buttonLabel"
    @click="searchCurrentArea"
  />
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useI18n } from "vue-i18n";
import { onMapReady } from "@/services/core/map";
import { isLoading, mapArea, setMapArea, type MapArea } from "@/services/feed/latestContributions";

const MIN_SEARCH_ZOOM = 5;
const BOUNDS_PRECISION = 1e-4;

const { t } = useI18n();
const currentArea = ref<MapArea | null>(null);
const currentZoom = ref(0);

const canSearch = computed(
  () => currentArea.value !== null && currentZoom.value >= MIN_SEARCH_ZOOM,
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
  target.on("moveend", updateMapArea);
});

onUnmounted(() => {
  stopWaitingForMap();
  listeningMap?.off("moveend", updateMapArea);
  listeningMap = null;
});

function searchCurrentArea(): void {
  if (!canSearch.value || !currentArea.value) return;
  setMapArea(currentArea.value);
}

function updateMapArea(): void {
  if (!listeningMap) return;
  const bounds = listeningMap.getBounds();
  currentArea.value = {
    west: normalizeLongitude(bounds.getWest()),
    south: bounds.getSouth(),
    east: normalizeLongitude(bounds.getEast()),
    north: bounds.getNorth(),
  };
  currentZoom.value = listeningMap.getZoom();
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
