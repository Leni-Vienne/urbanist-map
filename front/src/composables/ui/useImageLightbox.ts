import { computed, reactive, ref, useTemplateRef, watch } from "vue";

export interface LightboxImage {
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

  // Zoom toward the cursor: keep the image point under the cursor fixed by shifting the pan by the
  // cursor's offset from the rendered center, scaled by how much the zoom changed.
  function handleWheel(event: WheelEvent) {
    const img = imgRef.value;
    if (!img) return;

    const oldZoom = zoom.value;
    const next = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, oldZoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2)),
    );
    if (next === oldZoom) return;

    if (next === 1) {
      reset();
      return;
    }

    const rect = img.getBoundingClientRect();
    const offsetX = event.clientX - (rect.left + rect.width / 2);
    const offsetY = event.clientY - (rect.top + rect.height / 2);
    const factor = next / oldZoom;
    pan.x += offsetX * (1 - factor);
    pan.y += offsetY * (1 - factor);
    zoom.value = next;
  }

  function handlePointerDown(event: PointerEvent) {
    if (zoom.value <= 1) return;
    isPanning.value = true;
    panStart.x = event.clientX - pan.x;
    panStart.y = event.clientY - pan.y;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isPanning.value) return;
    pan.x = event.clientX - panStart.x;
    pan.y = event.clientY - panStart.y;
  }

  function handlePointerUp() {
    isPanning.value = false;
  }

  // Reset zoom whenever the lightbox opens or closes so it never reopens mid-zoom.
  watch(visible, reset);

  return {
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
  };
}
