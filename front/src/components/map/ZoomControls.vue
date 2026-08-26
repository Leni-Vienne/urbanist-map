<template>
  <div
    class="hidden md:flex flex-col rounded-lg overflow-hidden border border-surface bg-content-background/95 backdrop-blur-sm shadow-[0_2px_8px_rgba(0,0,0,0.2)] pointer-events-auto"
    @dblclick.stop
  >
    <button
      type="button"
      class="w-9 h-9 flex items-center justify-center text-color cursor-pointer transition-colors hover:bg-(--p-content-hover-background) disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
      :disabled="atMaxZoom"
      :aria-label="t('map.zoomIn')"
      :title="t('map.zoomIn')"
      @click="zoomIn"
    >
      <i class="pi pi-plus text-sm"></i>
    </button>

    <div class="h-px bg-content-border-color"></div>

    <button
      type="button"
      class="w-9 h-9 flex items-center justify-center text-color cursor-pointer transition-colors hover:bg-(--p-content-hover-background) disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
      :disabled="atMinZoom"
      :aria-label="t('map.zoomOut')"
      :title="t('map.zoomOut')"
      @click="zoomOut"
    >
      <i class="pi pi-minus text-sm"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { getMap, getMapOrNull, currentZoomLevel } from "@/services/core/map";
import { isTypingTarget } from "@/utils/keyboard";

const { t } = useI18n();

// currentZoomLevel updates on zoomend, so the disabled bounds settle once a zoom finishes.
const atMaxZoom = computed(() => {
  const mlMap = getMapOrNull();
  return mlMap !== null && currentZoomLevel.value >= mlMap.getMaxZoom() - 0.001;
});
const atMinZoom = computed(() => {
  const mlMap = getMapOrNull();
  return mlMap !== null && currentZoomLevel.value <= mlMap.getMinZoom() + 0.001;
});

function zoomIn() {
  getMap().zoomIn();
}

function zoomOut() {
  getMap().zoomOut();
}

function isModalOpen(): boolean {
  return document.querySelector(".p-dialog-mask, .p-drawer-mask") !== null;
}

function handleKeyDown(event: KeyboardEvent) {
  // Leave Ctrl/Cmd/Alt combos to the browser (e.g. native page zoom on Ctrl +/-).
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  // Don't steal +/- while the user is typing, or while a modal dialog/drawer is open.
  if (isTypingTarget(event.target) || isModalOpen()) return;

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomIn();
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    zoomOut();
  }
}

onMounted(() => {
  globalThis.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  globalThis.removeEventListener("keydown", handleKeyDown);
});
</script>
