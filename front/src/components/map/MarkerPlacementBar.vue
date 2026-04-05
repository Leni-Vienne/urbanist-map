<template>
  <!-- Floating bar for marker placement, positioned inside map container -->
  <Teleport to="#mapDiv">
    <!-- Semi-transparent backdrop to focus attention on map -->
    <div
      v-if="markerPlacementMode && visible"
      class="absolute inset-0 bg-black/30 z-1998 pointer-events-none"
    ></div>

    <div
      v-if="markerPlacementMode && visible"
      class="absolute top-2.5 left-2.5 right-2.5 md:top-5 md:left-1/2 md:right-auto md:-translate-x-1/2 bg-content-background border-2 border-primary-color rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.3)] flex items-center gap-4 px-4.5 py-3.5 md:px-6 md:py-4 md:max-w-[calc(100vw-40px)] md:min-w-[320px] z-2000"
      @click.stop
    >
      <div class="flex items-center gap-2 flex-1">
        <i class="pi pi-map-marker text-primary-color text-xl"></i>
        <div class="flex-1">
          <span v-if="!markerCoordinates" class="text-color text-base font-semibold">{{
            $t("project.clickMapToPlace")
          }}</span>
          <span v-else class="font-mono text-[15px] text-primary-color font-semibold"
            >{{ markerCoordinates.lat.toFixed(5) }}, {{ markerCoordinates.lng.toFixed(5) }}</span
          >
        </div>
      </div>
      <div class="flex gap-2">
        <Button
          v-if="markerCoordinates"
          :label="$t('common.continue')"
          size="small"
          @click="onContinue"
        />
        <Button :label="$t('common.cancel')" severity="secondary" size="small" @click="onCancel" />
      </div>
    </div>
    <!-- Cursor-following marker icon — hidden on touch/mobile devices -->
    <div
      v-if="markerPlacementMode && visible && !markerCoordinates"
      class="hidden md:block absolute pointer-events-none z-1999 -translate-x-1/2 -translate-y-full"
      :style="{ left: cursorPosition.x + 'px', top: cursorPosition.y + 'px' }"
      v-html="cursorMarkerSvg"
    ></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from "vue";
import { useMapStore } from "@/stores/pinia/mapStore";
import { map } from "@/services/core/map";
import { getMarkerSvg } from "@/services/map/markers";

// Component props and emits
interface Props {
  visible: boolean;
}

type Emits = {
  (e: "update:visible", value: boolean): void;
  (e: "marker-coordinates", coordinates: { lat: number; lng: number }): void;
  (e: "marker-mode-enabled"): void;
};

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// Component state
const markerCoordinates = ref<{ lat: number; lng: number } | null>(null);
const markerPlacementMode = ref(false);
const cursorPosition = ref({ x: 0, y: 0 });
const cursorMarkerSvg = getMarkerSvg("orange");

// Track mouse position over map for cursor-following marker
function onMouseMove(e: MouseEvent) {
  if (markerCoordinates.value) return;
  const mapContainer = map.value.getContainer();
  const rect = mapContainer.getBoundingClientRect();
  cursorPosition.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

// Setup/cleanup mouse move listener
watch(
  () => props.visible,
  (newVisible) => {
    if (newVisible) {
      document.addEventListener("mousemove", onMouseMove);
    } else {
      document.removeEventListener("mousemove", onMouseMove);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  document.removeEventListener("mousemove", onMouseMove);
});

// Handle visibility changes
const visible = computed({
  get: () => props.visible,
  set: (value) => emit("update:visible", value),
});

// Auto-enable marker placement when dialog opens
watch(
  () => props.visible,
  (newVisible) => {
    if (newVisible) {
      markerPlacementMode.value = true;
      emit("marker-mode-enabled");
    } else {
      resetState();
    }
  },
  { immediate: true },
);

// Handle marker coordinates from map click
function setMarkerCoordinates(coordinates: { lat: number; lng: number }) {
  markerCoordinates.value = coordinates;
}

// Cancel marker placement
function onCancel() {
  emit("update:visible", false);
}

// Continue with marker coordinates
function onContinue() {
  if (markerCoordinates.value) {
    emit("marker-coordinates", markerCoordinates.value);
  }
  resetState();
  emit("update:visible", false);
}

// Reset all state
function resetState() {
  markerCoordinates.value = null;
  markerPlacementMode.value = false;
}

// Close dialog when map mode changes (prevents mixed mode states)
const mapStore = useMapStore();
watch(
  () => mapStore.mode,
  () => {
    if (markerPlacementMode.value) {
      onCancel();
    }
  },
);

// Expose functions to parent component
defineExpose({
  setMarkerCoordinates,
});
</script>
