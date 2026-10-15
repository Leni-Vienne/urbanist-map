<template>
  <div
    v-if="!failed"
    class="render-pin"
    :class="{ 'is-selected': selected }"
    :style="{
      '--pin-color': data.color,
      '--pin-preview-width': `${previewDimensions.width}px`,
      '--pin-preview-height': `${previewDimensions.height}px`,
    }"
    @pointerdown.stop
    @mousemove.stop
    @dblclick.stop
    @mouseenter="hoverProject"
    @mouseleave="focus.setHoverTarget(null)"
  >
    <div class="render-pin-frame">
      <button
        type="button"
        tabindex="-1"
        class="render-pin-project"
        :aria-label="`${data.name || t('project.unnamed')} — ${t('render.label')}`"
        @mousedown.prevent
        @click.stop="openProject"
      >
        <img
          :key="data.thumbnailUrl"
          :src="data.thumbnailUrl"
          :crossorigin="imageRequiresCredentials(data.thumbnailUrl) ? 'use-credentials' : undefined"
          :alt="t('render.label')"
          draggable="false"
          @load="handleImageLoad"
          @error="handleImageError"
        />
      </button>
      <!-- Keep positioning separate from the button's ripple styles. -->
      <div class="render-pin-zoom">
        <Button
          icon="pi pi-search-plus"
          severity="secondary"
          size="small"
          rounded
          :tabindex="-1"
          :aria-label="t('overlay.viewFullImage')"
          v-tooltip.bottom="{
            value: t('overlay.viewFullImage'),
            disabled: isMobile,
            showDelay: 300,
          }"
          @mousedown.prevent
          @click.stop="$emit('open-image')"
        />
      </div>
    </div>
    <span
      class="render-pin-label bg-content-background rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.14),0_1px_4px_rgba(0,0,0,0.06)] px-3 py-2 max-w-56 text-sm font-semibold leading-snug"
      :class="data.name ? 'text-color' : 'text-muted-color italic'"
      >{{ data.name || t("project.unnamed") }}</span
    >
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RenderImagePinData } from "@/services/map/renderImagePin";
import { imageRequiresCredentials } from "@/utils/imageUrl";
import { openProjectDetailById } from "@/services/core/projectSelection";
import { clearHoverPreview } from "@/services/map/hoverPreviewState";
import { useFocusStore } from "@/stores/focusStore";
import { isMobile } from "@/services/core/viewport";

const props = defineProps<{ data: RenderImagePinData; selected: boolean }>();
const emit = defineEmits<{
  "open-image": [];
  "image-visibility-change": [visible: boolean];
}>();
const { t } = useI18n();
const focus = useFocusStore();
const failed = ref(false);
const loaded = ref(false);
const previewDimensions = ref({ width: 56, height: 42 });

watch(
  () => props.data.thumbnailUrl,
  () => {
    failed.value = false;
    loaded.value = false;
    previewDimensions.value = { width: 56, height: 42 };
  },
);

watch(
  () => loaded.value && !failed.value,
  (visible) => emit("image-visibility-change", visible),
);

function handleImageLoad(event: Event): void {
  const image = event.currentTarget;
  if (!(image instanceof HTMLImageElement)) return;
  // Fit inside the hover bounds without enlarging the thumbnail's actual pixels.
  const scale = Math.min(1, 120 / image.naturalWidth, 88 / image.naturalHeight);
  previewDimensions.value = {
    width: Math.floor(image.naturalWidth * scale),
    height: Math.floor(image.naturalHeight * scale),
  };
  loaded.value = true;
}

function handleImageError(): void {
  loaded.value = false;
  failed.value = true;
}

function hoverProject(): void {
  clearHoverPreview();
  focus.setHoverTarget({ kind: "project", projectId: props.data.projectId });
}

function openProject(): void {
  clearHoverPreview();
  openProjectDetailById(props.data.projectId);
}
</script>

<style scoped>
.render-pin {
  --pin-width: 56px;
  --pin-height: 42px;
  position: relative;
  /* Keep MapLibre's anchor fixed while the frame expands above it. */
  width: 56px;
  height: 49px;
}

.render-pin::before,
.render-pin::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
}

.render-pin::before {
  border: 7px solid transparent;
  border-bottom: 0;
  border-top-color: #fff;
  filter: drop-shadow(0 1px 1px #0003);
}

.render-pin::after {
  bottom: 1px;
  border: 5px solid transparent;
  border-bottom: 0;
  border-top-color: var(--pin-color);
}

.render-pin-frame {
  position: absolute;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  width: var(--pin-width);
  height: var(--pin-height);
  overflow: hidden;
  z-index: 1;
  border: 2px solid #fff;
  border-radius: 6px;
  background: #fff;
  box-shadow:
    0 0 0 1px #17212b33,
    0 2px 5px #17212b40;
  transition:
    width 180ms ease-out,
    height 180ms ease-out,
    border-color 120ms,
    box-shadow 120ms;
}

.is-selected .render-pin-frame {
  border-color: var(--pin-color);
}

.render-pin-project,
.render-pin-project img {
  display: block;
  width: 100%;
  height: 100%;
}

.render-pin-project {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.render-pin-project img {
  object-fit: cover;
}

.render-pin-zoom {
  position: absolute;
  right: 4px;
  bottom: 4px;
  display: flex;
  transition: opacity 120ms;
}

.render-pin-label {
  position: absolute;
  bottom: calc(var(--pin-height) + 12px);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  overflow-wrap: break-word;
  pointer-events: none;
  transition: opacity 120ms;
}

.render-pin-label,
.render-pin-zoom {
  opacity: 0;
  visibility: hidden;
}

@media (hover: hover) and (pointer: fine) {
  .render-pin:hover {
    --pin-width: var(--pin-preview-width);
    --pin-height: var(--pin-preview-height);
  }

  .render-pin:hover .render-pin-frame {
    box-shadow:
      0 0 0 1px #17212b40,
      0 4px 10px #17212b40;
  }

  .render-pin:hover .render-pin-label,
  .render-pin:hover .render-pin-zoom {
    opacity: 1;
    visibility: visible;
  }
}

@media (prefers-reduced-motion: reduce) {
  .render-pin-frame,
  .render-pin-label,
  .render-pin-zoom {
    transition: none;
  }
}
</style>
