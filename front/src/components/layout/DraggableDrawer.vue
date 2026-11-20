<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-1100 pointer-events-none">
      <div
        ref="drawer"
        class="draggable-drawer fixed bottom-0 left-0 right-0 bg-content-background rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] flex flex-col overflow-visible z-1101 touch-none pointer-events-auto"
        :class="{ 'is-dragging': drag }"
        :style="{ '--drawer-height': `${(currentHeight / 100) * viewportHeight}px` }"
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
          class="drawer-handle h-(--drawer-handle-height) flex justify-center items-center cursor-grab active:cursor-grabbing shrink-0 rounded-t-2xl"
          role="slider"
          tabindex="0"
          aria-orientation="vertical"
          :aria-label="$t('navigation.drawerHeight')"
          :aria-valuemin="Math.round(minHeightPercent)"
          :aria-valuemax="MAX_HEIGHT_PERCENT"
          :aria-valuenow="Math.round(Math.max(minHeightPercent, currentHeight))"
          @keydown.up.prevent="setHeight(currentHeight + 10)"
          @keydown.down.prevent="setHeight(currentHeight - 10)"
          @keydown.home.prevent="setHeight(minHeightPercent)"
          @keydown.end.prevent="setHeight(MAX_HEIGHT_PERCENT)"
          @click.stop
        >
          <div
            class="w-10 h-1 bg-(--p-text-muted-color) rounded-sm transition-colors duration-200 hover:bg-(--p-text-color-secondary)"
          ></div>
        </div>

        <div class="drawer-header shrink-0 cursor-grab active:cursor-grabbing">
          <slot name="header" :collapsed="isCompact"></slot>
        </div>

        <div
          :inert="isCompact && !peekTarget"
          class="flex flex-col min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-none [&::-webkit-scrollbar]:hidden bg-content-background"
        >
          <slot></slot>
        </div>

        <div v-if="$slots.footer" class="drawer-footer shrink-0 overflow-clip">
          <slot name="footer"></slot>
        </div>
        <div class="h-[env(safe-area-inset-bottom)] shrink-0"></div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, useTemplateRef } from "vue";

interface Props {
  peekTarget?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  peekTarget: null,
});

const MAX_HEIGHT_PERCENT = 75;
const PEEK_HEIGHT_PX = 128;

const currentHeight = defineModel<number>("heightPercent", { required: true });
const drawer = useTemplateRef<HTMLElement>("drawer");

const drag = shallowRef<{
  pointerId: number;
  element: HTMLElement;
  startY: number;
  startHeight: number;
} | null>(null);
const viewportHeight = ref(globalThis.innerHeight);
const minHeightPx = ref(0);
let autoPeek = false;

const minHeightPercent = computed(() => {
  return (minHeightPx.value / viewportHeight.value) * 100;
});

const isCompact = computed(() => {
  return currentHeight.value <= minHeightPercent.value;
});

watch(getPeekTarget, updatePeek);

function getPeekTarget(): string | null {
  return props.peekTarget;
}

function peekHeightPercent(): number {
  return Math.min(MAX_HEIGHT_PERCENT, (PEEK_HEIGHT_PX / viewportHeight.value) * 100);
}

function updatePeek(peekTarget: string | null): void {
  if (viewportHeight.value <= 0 || drag.value) return;
  if (peekTarget !== null) {
    if (!isCompact.value && !autoPeek) return;
    autoPeek = true;
    currentHeight.value = peekHeightPercent();
  } else {
    if (!autoPeek) return;
    autoPeek = false;
    currentHeight.value = minHeightPercent.value;
  }
}

function setHeight(percent: number): void {
  autoPeek = false;
  currentHeight.value = Math.min(MAX_HEIGHT_PERCENT, Math.max(minHeightPercent.value, percent));
}

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
  const height = viewportHeight.value - element.getBoundingClientRect().top;
  const startHeight = (height / viewportHeight.value) * 100;
  if (Math.abs(height - (currentHeight.value / 100) * viewportHeight.value) > 1) {
    currentHeight.value = startHeight;
  }
  drag.value = {
    pointerId: event.pointerId,
    element,
    startY: event.clientY,
    startHeight,
  };
}

function moveDrag(event: PointerEvent) {
  const active = drag.value;
  if (!active || active.pointerId !== event.pointerId) return;
  const delta = ((active.startY - event.clientY) / viewportHeight.value) * 100;
  autoPeek = false;
  currentHeight.value = Math.max(0, Math.min(MAX_HEIGHT_PERCENT, active.startHeight + delta));
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
}

function handleResize() {
  const wasCollapsed = isCompact.value;
  releaseDrag();
  viewportHeight.value = globalThis.innerHeight;
  if (drawer.value) minHeightPx.value = Number.parseFloat(getComputedStyle(drawer.value).minHeight);
  if (autoPeek) currentHeight.value = peekHeightPercent();
  else setHeight(wasCollapsed ? minHeightPercent.value : currentHeight.value);
}

onMounted(() => {
  handleResize();
  updatePeek(props.peekTarget);
  globalThis.addEventListener("resize", handleResize);
});

onBeforeUnmount(() => {
  releaseDrag();
  globalThis.removeEventListener("resize", handleResize);
});
</script>

<style scoped>
.draggable-drawer {
  --drawer-handle-height: 1.25rem;
  --drawer-tab-height: 2.75rem;
  --resting-height: calc(
    var(--drawer-handle-height) + var(--drawer-tab-height) + env(safe-area-inset-bottom)
  );
  min-height: var(--resting-height);
  height: var(--drawer-height);
  translate: 0 max(0px, calc(var(--resting-height) - var(--drawer-height)));
  container: mobile-drawer / size;
}

.drawer-footer {
  max-height: max(0px, calc(100% - 40dvh));
}

@container mobile-drawer (height <= 40dvh) {
  .drawer-footer {
    visibility: hidden;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .draggable-drawer:not(.is-dragging) {
    transition:
      height 300ms cubic-bezier(0.4, 0, 0.2, 1),
      translate 300ms cubic-bezier(0.4, 0, 0.2, 1);
  }
}
</style>
