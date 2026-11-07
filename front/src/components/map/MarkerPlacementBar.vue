<template>
  <Teleport to="#mapDiv">
    <div v-if="visible" class="absolute inset-0 bg-black/30 z-1998 pointer-events-none"></div>

    <div
      v-if="visible"
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
    <!-- Cursor-following marker, hidden on mobile -->
    <div
      v-if="visible && !markerCoordinates"
      class="hidden md:block absolute pointer-events-none z-1999 -translate-x-1/2 -translate-y-full"
      :style="{ left: cursorPosition.x + 'px', top: cursorPosition.y + 'px' }"
      v-html="cursorMarkerSvg"
    ></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { storeToRefs } from "pinia";
import { useUiStore } from "@/stores/uiStore";
import { getMap } from "@/services/core/map";
import { getMarkerSvg } from "@/services/core/markersSvg";

const uiStore = useUiStore();
const { markerPlacementBarVisible: visible, markerCoordinates } = storeToRefs(uiStore);
const cursorPosition = ref({ x: 0, y: 0 });
const cursorMarkerSvg = getMarkerSvg("orange");

function onMouseMove(e: MouseEvent) {
  if (markerCoordinates.value) return;
  const mapContainer = getMap().getContainer();
  const rect = mapContainer.getBoundingClientRect();
  cursorPosition.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

watch(
  visible,
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

function onCancel() {
  uiStore.cancelProjectPlacement();
}

function onContinue() {
  if (markerCoordinates.value) {
    uiStore.openProjectDialog(markerCoordinates.value);
  }
}
</script>
