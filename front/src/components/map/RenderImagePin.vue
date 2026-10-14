<template>
  <div
    v-if="!failed"
    class="render-pin"
    :class="{ 'is-selected': selected }"
    :style="{ '--pin-color': data.color }"
    @pointerdown.stop
    @mousemove.stop
    @dblclick.stop
    @mouseenter="hoverProject"
    @mouseleave="focus.setHoverTarget(null)"
    @focusin="hoverProject"
    @focusout="focus.setHoverTarget(null)"
  >
    <div class="render-pin-frame">
      <button
        type="button"
        class="render-pin-project"
        :aria-label="`${data.name || t('project.unnamed')} — ${t('render.label')}`"
        @click.stop="openProject"
      >
        <img
          :src="imageSrc"
          :crossorigin="imageRequiresCredentials(imageSrc) ? 'use-credentials' : undefined"
          :alt="t('render.label')"
          draggable="false"
          @load="loaded = true"
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
          :aria-label="t('overlay.viewFullImage')"
          v-tooltip.bottom="{
            value: t('overlay.viewFullImage'),
            disabled: isMobile,
            showDelay: 300,
          }"
          @click.stop="$emit('open-image')"
        />
      </div>
    </div>
    <span
      class="render-pin-label text-sm font-semibold leading-snug"
      :class="data.name ? 'text-color' : 'text-muted-color italic'"
      >{{ data.name || t("project.unnamed") }}</span
    >
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
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
const useOriginal = ref(false);
const failed = ref(false);
const loaded = ref(false);
const imageSrc = computed(() =>
  useOriginal.value ? props.data.imageUrl : props.data.thumbnailUrl,
);

watch(
  () => props.data.thumbnailUrl,
  () => {
    useOriginal.value = false;
    failed.value = false;
    loaded.value = false;
  },
);

watch(
  () => loaded.value && !failed.value,
  (visible) => emit("image-visibility-change", visible),
);

function handleImageError(): void {
  loaded.value = false;
  if (useOriginal.value) failed.value = true;
  else useOriginal.value = true;
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

.render-pin::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  border: 7px solid transparent;
  border-bottom: 0;
  border-top-color: var(--pin-color);
}

.render-pin-frame {
  position: absolute;
  bottom: 7px;
  left: 50%;
  transform: translateX(-50%);
  width: var(--pin-width);
  height: var(--pin-height);
  overflow: hidden;
  border: 1.5px solid var(--pin-color);
  border-radius: 8px;
  background: var(--pin-color);
  box-shadow:
    0 0 0 1px #ffffffe6,
    0 2px 4px #0003;
  transition:
    width 180ms,
    height 180ms;
}

.is-selected .render-pin-frame {
  outline: 2px solid var(--pin-color);
  outline-offset: 1px;
}

.render-pin-project,
.render-pin-project img {
  display: block;
  width: 100%;
  height: 100%;
}

.render-pin-project {
  cursor: pointer;
}

.render-pin-project:focus-visible {
  outline: 3px solid white;
  outline-offset: -4px;
}

.render-pin-project img {
  object-fit: cover;
}

.render-pin-zoom {
  position: absolute;
  right: 5px;
  bottom: 5px;
  display: flex;
}

.render-pin-label {
  position: absolute;
  bottom: calc(var(--pin-height) + 11px);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 12rem;
  padding: 0.375rem 0.625rem;
  border-radius: 8px;
  background: var(--p-content-background);
  text-align: center;
  overflow-wrap: break-word;
  box-shadow: 0 2px 8px #0002;
  pointer-events: none;
  transition: opacity 180ms;
}

.render-pin-label,
.render-pin-zoom {
  opacity: 0;
  visibility: hidden;
}

.render-pin:has(:focus-visible) {
  --pin-width: 128px;
  --pin-height: 88px;
}

.render-pin:has(:focus-visible) .render-pin-label,
.render-pin:has(:focus-visible) .render-pin-zoom {
  opacity: 1;
  visibility: visible;
}

@media (hover: hover) and (pointer: fine) {
  .render-pin:is(:hover, :focus-within) {
    --pin-width: 128px;
    --pin-height: 88px;
  }

  .render-pin:is(:hover, :focus-within) .render-pin-label,
  .render-pin:is(:hover, :focus-within) .render-pin-zoom {
    opacity: 1;
    visibility: visible;
  }
}

@media (prefers-reduced-motion: reduce) {
  .render-pin-frame,
  .render-pin-label {
    transition: none;
  }
}
</style>
