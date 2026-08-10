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
      content: { class: 'p-0' },
    }"
  >
    <div
      class="overflow-hidden max-h-[80vh] w-full sm:w-auto sm:max-w-full flex items-center justify-center touch-none"
      @wheel.prevent="handleWheel"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
      @pointerleave="handlePointerUp"
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
import { computed, reactive, ref, useTemplateRef, watch } from "vue";

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
const zoom = ref(1);
const pan = reactive({ x: 0, y: 0 });
const isPanning = ref(false);
const panStart = { x: 0, y: 0 };

// Active pointers by id, so two simultaneous touches can drive pinch-to-zoom.
const pointers = new Map<number, { x: number; y: number }>();
let lastPinchDist = 0;

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
    reset();
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
}

function handlePointerDown(event: PointerEvent) {
  // oxlint-disable-next-line no-unsafe-type-assertion
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (pointers.size === 2) {
    isPanning.value = false;
    const [a, b] = [...pointers.values()];
    if (a && b) lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    return;
  }

  if (zoom.value <= 1) return;
  isPanning.value = true;
  panStart.x = event.clientX - pan.x;
  panStart.y = event.clientY - pan.y;
}

function handlePointerMove(event: PointerEvent) {
  const p = pointers.get(event.pointerId);
  if (p) {
    p.x = event.clientX;
    p.y = event.clientY;
  }

  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    if (a && b) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinchDist > 0) {
        applyZoom(zoom.value * (dist / lastPinchDist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      lastPinchDist = dist;
    }
    return;
  }

  if (!isPanning.value) return;
  pan.x = event.clientX - panStart.x;
  pan.y = event.clientY - panStart.y;
}

function handlePointerUp(event: PointerEvent) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) lastPinchDist = 0;

  // Hand panning back to the remaining finger so lifting one of a pinch doesn't snap the image.
  if (pointers.size === 1 && zoom.value > 1) {
    const [p] = [...pointers.values()];
    if (p) {
      isPanning.value = true;
      panStart.x = p.x - pan.x;
      panStart.y = p.y - pan.y;
    }
  } else if (pointers.size === 0) {
    isPanning.value = false;
  }
}

// Reset zoom whenever the lightbox opens or closes so it never reopens mid-zoom or mid-gesture.
watch(visible, () => {
  reset();
  pointers.clear();
  lastPinchDist = 0;
  isPanning.value = false;
});

defineExpose({ open });
</script>
