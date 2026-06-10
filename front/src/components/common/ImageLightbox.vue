<template>
  <!-- Full-size image lightbox: scroll to zoom (toward cursor), drag to pan, double-click to reset -->
  <Dialog
    v-model:visible="lightbox.visible"
    modal
    dismissableMask
    :draggable="false"
    :header="lightbox.image?.header"
    :pt="{
      root: {
        class:
          'w-screen max-w-none m-0 rounded-none sm:w-auto sm:max-w-[90vw] sm:m-auto sm:rounded-xl',
      },
      content: { class: 'p-0' },
    }"
  >
    <div
      class="overflow-hidden max-h-[80vh] w-full sm:w-auto sm:max-w-full flex items-center justify-center touch-none"
      @wheel.prevent="lightbox.handleWheel"
      @pointerdown="lightbox.handlePointerDown"
      @pointermove="lightbox.handlePointerMove"
      @pointerup="lightbox.handlePointerUp"
      @pointercancel="lightbox.handlePointerUp"
      @pointerleave="lightbox.handlePointerUp"
      @dblclick="lightbox.reset"
    >
      <img
        v-if="lightbox.image"
        ref="lightboxImg"
        :src="lightbox.image.url"
        :crossorigin="lightbox.image.crossorigin"
        :referrerpolicy="lightbox.image.referrerpolicy"
        class="block max-h-full max-w-full object-contain select-none"
        :class="
          lightbox.zoom > 1
            ? lightbox.isPanning
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-zoom-in'
        "
        :style="{
          transform: `translate(${lightbox.pan.x}px, ${lightbox.pan.y}px) scale(${lightbox.zoom})`,
        }"
        draggable="false"
        alt=""
      />
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { useImageLightbox } from "@/composables/ui/useImageLightbox";

const lightbox = useImageLightbox();

defineExpose({ open: lightbox.open });
</script>
