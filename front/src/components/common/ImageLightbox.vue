<template>
  <!-- Full-size image lightbox: scroll to zoom (toward cursor), drag to pan, double-click to reset -->
  <Dialog
    v-model:visible="visible"
    modal
    dismissableMask
    :draggable="false"
    :header="image?.header"
    :pt="{
      root: {
        class:
          'w-screen max-w-none m-0 rounded-none sm:w-auto sm:max-w-[90vw] sm:m-auto sm:rounded-xl',
      },
      content: {
        class: 'flex min-h-0',
        style: { overflow: 'hidden' },
      },
    }"
  >
    <!-- Shrink to the space below the header so the image's percentage height limit resolves. -->
    <div
      ref="imageViewport"
      class="overflow-hidden min-h-0 w-full sm:w-auto sm:max-w-full flex items-center justify-center touch-none"
      @wheel.prevent="handleWheel"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
      @lostpointercapture="handlePointerUp"
      @dblclick="reset"
    >
      <img
        v-if="image"
        ref="lightboxImg"
        :src="image.url"
        :crossorigin="image.crossorigin"
        :referrerpolicy="image.referrerpolicy"
        class="block max-h-full max-w-full object-contain select-none"
        :class="zoom > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'"
        :style="{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }"
        draggable="false"
        alt=""
      />
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, useTemplateRef, watch } from "vue";

interface LightboxImage {
  url: string;
  header: string;
  crossorigin?: "use-credentials" | "anonymous" | "";
  referrerpolicy?: ReferrerPolicy;
}

// Call sites pass a nullable url (guarded upstream); open() no-ops when it is absent.
type LightboxSource = Omit<LightboxImage, "url"> & { url: string | null | undefined };

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

const image = ref<LightboxImage | null>(null);
const imgRef = useTemplateRef<HTMLImageElement>("lightboxImg");
const viewport = useTemplateRef<HTMLElement>("imageViewport");
const zoom = ref(1);
const pan = reactive({ x: 0, y: 0 });
const gesture = shallowRef<
  | { type: "pan"; pointerId: number; startX: number; startY: number }
  | { type: "pinch"; distance: number }
  | null
>(null);
const isPanning = computed(() => gesture.value?.type === "pan");

// Active pointers by id, so two simultaneous touches can drive pinch-to-zoom.
const pointers = new Map<number, { x: number; y: number }>();

const visible = computed({
  get: () => image.value !== null,
  set: (value: boolean) => {
    if (!value) image.value = null;
  },
});

function open(next: LightboxSource) {
  if (!next.url) return;
  image.value = { ...next, url: next.url };
}

function reset() {
  zoom.value = 1;
  pan.x = 0;
  pan.y = 0;
  const ids = [...pointers.keys()];
  pointers.clear();
  gesture.value = null;
  for (const id of ids) {
    if (viewport.value?.hasPointerCapture(id)) viewport.value.releasePointerCapture(id);
  }
}

// Zoom toward a focal point (cursor or pinch midpoint): keep the image point under the focus fixed
// by shifting the pan by the focus's offset from the rendered center, scaled by the zoom change.
function applyZoom(target: number, focusX: number, focusY: number) {
  const img = imgRef.value;
  if (!img) return;

  const oldZoom = zoom.value;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, target));
  if (next === oldZoom) return;

  if (next === 1) {
    zoom.value = 1;
    pan.x = 0;
    pan.y = 0;
    return;
  }

  const rect = img.getBoundingClientRect();
  const offsetX = focusX - (rect.left + rect.width / 2);
  const offsetY = focusY - (rect.top + rect.height / 2);
  const factor = next / oldZoom;
  pan.x += offsetX * (1 - factor);
  pan.y += offsetY * (1 - factor);
  zoom.value = next;
}

function handleWheel(event: WheelEvent) {
  applyZoom(zoom.value * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX, event.clientY);
  rebaseGesture();
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0 || pointers.size >= 2 || !(event.currentTarget instanceof HTMLElement)) {
    return;
  }
  event.currentTarget.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  rebaseGesture();
}

function rebaseGesture() {
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    if (a && b) gesture.value = { type: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y) };
    return;
  }
  const remaining = pointers.entries().next().value;
  gesture.value =
    remaining && zoom.value > 1
      ? {
          type: "pan",
          pointerId: remaining[0],
          startX: remaining[1].x - pan.x,
          startY: remaining[1].y - pan.y,
        }
      : null;
}

function handlePointerMove(event: PointerEvent) {
  const p = pointers.get(event.pointerId);
  if (!p) return;
  p.x = event.clientX;
  p.y = event.clientY;
  const active = gesture.value;

  if (active?.type === "pinch") {
    const [a, b] = [...pointers.values()];
    if (a && b) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (active.distance > 0) {
        applyZoom(zoom.value * (dist / active.distance), (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      gesture.value = { type: "pinch", distance: dist };
    }
    return;
  }

  if (active?.type !== "pan" || active.pointerId !== event.pointerId) return;
  pan.x = event.clientX - active.startX;
  pan.y = event.clientY - active.startY;
}

function handlePointerUp(event: PointerEvent) {
  if (!pointers.delete(event.pointerId)) return;
  rebaseGesture();
}

// Replacing the image while already open must also end the old image's gesture.
watch(image, reset, { flush: "sync" });
onBeforeUnmount(reset);

defineExpose({ open });
</script>
