<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-1100 pointer-events-none">
      <div
        class="draggable-drawer fixed bottom-0 left-0 right-0 bg-content-background rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] flex flex-col overflow-visible z-1101 touch-none pointer-events-auto"
        :style="drawerStyle"
        @pointerdown="beginDrag"
        @pointermove="moveDrag"
        @pointerup="finishDrag"
        @pointercancel="finishDrag"
        @lostpointercapture="finishDrag"
      >
        <!-- Slot for content above drawer (e.g., mode controls) -->
        <div class="absolute left-0 right-0 bottom-full mb-2 pointer-events-none">
          <slot name="above"></slot>
        </div>

        <div
          class="drawer-handle py-2 pb-[0.4rem] flex justify-center items-center cursor-grab active:cursor-grabbing shrink-0 rounded-t-2xl"
          @click.stop
        >
          <div
            class="w-10 h-1 bg-(--p-text-muted-color) rounded-sm transition-colors duration-200 hover:bg-(--p-text-color-secondary)"
          ></div>
        </div>

        <div
          class="drawer-header shrink-0 cursor-grab active:cursor-grabbing transition-[padding] duration-300 ease-in-out"
          :class="{ 'py-0 px-4 pb-[0.3em] text-center': isCompact }"
        >
          <slot name="header"></slot>
        </div>

        <div
          class="flex flex-col min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-none [&::-webkit-scrollbar]:hidden bg-content-background"
        >
          <slot></slot>
        </div>

        <!-- Footer (outside scroll area so it's always opaque and visible) -->
        <div v-if="$slots.footer" class="shrink-0">
          <slot name="footer"></slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from "vue";

interface Props {
  heightPercent?: number;
}

const props = withDefaults(defineProps<Props>(), {
  heightPercent: 40,
});

// Internal configuration (not exposed as props)
const MIN_HEIGHT_PX = 65;
const MAX_HEIGHT_PERCENT = 75;

const emit = defineEmits<{
  "update:heightPercent": [value: number];
}>();

const drag = shallowRef<{
  pointerId: number;
  element: HTMLElement;
  startY: number;
  startHeight: number;
  viewportHeight: number;
} | null>(null);
const isDragging = computed(() => drag.value !== null);
const currentHeight = ref(props.heightPercent);
const viewportHeight = ref(globalThis.innerHeight);

// Convert minimum height from pixels to viewport percentage
const minHeightPercent = computed(() => {
  return (MIN_HEIGHT_PX / viewportHeight.value) * 100;
});

const drawerStyle = computed(() => {
  const height = Math.min(MAX_HEIGHT_PERCENT, currentHeight.value);
  return {
    height: `${height}vh`,
    transition: isDragging.value ? "none" : "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  };
});

const isCompact = computed(() => {
  return currentHeight.value <= minHeightPercent.value;
});

watch(
  () => props.heightPercent,
  (newHeight) => {
    if (!isDragging.value) {
      currentHeight.value = newHeight;
    }
  },
);

// Keep drawer at minimum height when viewport resizes
watch(
  () => minHeightPercent.value,
  (newMinPercent, oldMinPercent) => {
    if (!isDragging.value && oldMinPercent > 0) {
      const wasAtMinimum = Math.abs(currentHeight.value - oldMinPercent) < 0.5;
      if (wasAtMinimum) {
        currentHeight.value = newMinPercent;
        emit("update:heightPercent", newMinPercent);
      }
    }
  },
);

function beginDrag(event: PointerEvent) {
  if (drag.value || !event.isPrimary || event.button !== 0) return;
  const target = event.target;
  const element = event.currentTarget;
  if (!(target instanceof Element) || !(element instanceof HTMLElement)) return;
  if (!target.closest(".drawer-handle, .drawer-header, .drawer-drag-handle")) return;
  // Header controls keep their clicks and focus instead of starting a captured drag.
  if (target.closest("button, a, input, select, textarea, [role=button]")) return;
  event.preventDefault();
  element.setPointerCapture(event.pointerId);
  drag.value = {
    pointerId: event.pointerId,
    element,
    startY: event.clientY,
    startHeight: currentHeight.value,
    viewportHeight: globalThis.innerHeight,
  };
}

function moveDrag(event: PointerEvent) {
  const active = drag.value;
  if (!active || active.pointerId !== event.pointerId) return;
  const delta = ((active.startY - event.clientY) / active.viewportHeight) * 100;
  currentHeight.value = Math.min(MAX_HEIGHT_PERCENT, active.startHeight + delta);
  emit("update:heightPercent", currentHeight.value);
}

function releaseDrag() {
  const active = drag.value;
  drag.value = null;
  if (active?.element.hasPointerCapture(active.pointerId)) {
    active.element.releasePointerCapture(active.pointerId);
  }
}

function finishDrag(event: PointerEvent) {
  if (drag.value?.pointerId !== event.pointerId) return;
  releaseDrag();
  currentHeight.value = Math.max(minHeightPercent.value, currentHeight.value);
  emit("update:heightPercent", currentHeight.value);
}

function handleResize() {
  releaseDrag();
  viewportHeight.value = globalThis.innerHeight;
  currentHeight.value = Math.min(
    MAX_HEIGHT_PERCENT,
    Math.max(minHeightPercent.value, currentHeight.value),
  );
  emit("update:heightPercent", currentHeight.value);
}

onMounted(() => {
  currentHeight.value = props.heightPercent;
  viewportHeight.value = globalThis.innerHeight;

  globalThis.addEventListener("resize", handleResize);
});

onBeforeUnmount(() => {
  releaseDrag();
  globalThis.removeEventListener("resize", handleResize);
});
</script>
