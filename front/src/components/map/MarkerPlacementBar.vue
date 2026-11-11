<template>
  <Teleport to="#mapDiv">
    <div class="absolute inset-0 bg-black/30 z-1998 pointer-events-none"></div>

    <div
      class="absolute top-2.5 left-2.5 right-2.5 md:top-5 md:left-1/2 md:right-auto md:-translate-x-1/2 bg-content-background border-2 border-primary-color rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.3)] flex items-center gap-4 px-4.5 py-3.5 md:px-6 md:py-4 md:max-w-[calc(100vw-40px)] md:min-w-[320px] z-2000"
      @click.stop
    >
      <div class="flex items-center gap-2 flex-1">
        <i class="pi pi-map-marker text-primary-color text-xl"></i>
        <div class="flex-1">
          <span v-if="!coordinates" class="text-color text-base font-semibold">{{
            $t("project.clickMapToPlace")
          }}</span>
          <span v-else class="font-mono text-[15px] text-primary-color font-semibold"
            >{{ coordinates.lat.toFixed(5) }}, {{ coordinates.lng.toFixed(5) }}</span
          >
        </div>
      </div>
      <div class="flex gap-2">
        <Button
          v-if="coordinates"
          :label="$t('common.continue')"
          size="small"
          @click="onContinue"
        />
        <Button
          :label="$t('common.cancel')"
          severity="secondary"
          size="small"
          @click="uiStore.closeEditor('place-project')"
        />
      </div>
    </div>
    <!-- Cursor-following marker, hidden on mobile -->
    <div
      v-if="!coordinates"
      class="hidden md:block absolute pointer-events-none z-1999 -translate-x-1/2 -translate-y-full"
      :style="{ left: cursorPosition.x + 'px', top: cursorPosition.y + 'px' }"
      v-html="cursorMarkerSvg"
    ></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useUiStore, type ProjectCoordinates } from "@/stores/uiStore";
import { getMap } from "@/services/core/map";
import { getMarkerSvg } from "@/services/core/markersSvg";

const uiStore = useUiStore();
const { coordinates } = defineProps<{ coordinates: ProjectCoordinates | null }>();
const cursorPosition = ref({ x: 0, y: 0 });
const cursorMarkerSvg = getMarkerSvg("orange");

function onMouseMove(e: MouseEvent) {
  if (coordinates) return;
  const mapContainer = getMap().getContainer();
  const rect = mapContainer.getBoundingClientRect();
  cursorPosition.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

onMounted(() => document.addEventListener("mousemove", onMouseMove));

onUnmounted(() => {
  document.removeEventListener("mousemove", onMouseMove);
});

function onContinue() {
  if (coordinates) {
    uiStore.openEditor({ type: "create-project", coordinates });
  }
}
</script>
