import { computed, reactive, ref, useTemplateRef, watch } from "vue";

interface LightboxImage {
  url: string;
  header: string;
  crossorigin?: "use-credentials" | "anonymous" | "";
  referrerpolicy?: ReferrerPolicy;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

// Full-size image viewer: scroll to zoom (toward the cursor), drag to pan, double-click to reset.
// The consuming template must attach the image element with ref="lightboxImg".
export function useImageLightbox() {
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

  function open(next: LightboxImage) {
    image.value = next;
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

  // Reactive namespace so the consumer keeps it whole (const lightbox = useImageLightbox())
  // and reads lightbox.image / lightbox.zoom in the template without ref-unwrapping noise.
  return reactive({
    image,
    zoom,
    pan,
    isPanning,
    visible,
    open,
    reset,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  });
}
