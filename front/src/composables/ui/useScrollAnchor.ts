import { computed, onBeforeUnmount, shallowRef, watch, type Ref } from "vue";

/** Keep a row in place through layout changes until the next user interaction. */
export function useScrollAnchor(scrollAreaRef: Readonly<Ref<HTMLElement | null>>) {
  const anchor = shallowRef<{ observer: ResizeObserver; input: AbortController } | null>(null);
  const isAnchoring = computed(() => anchor.value !== null);

  function clearAnchor(): void {
    const previous = anchor.value;
    anchor.value = null;
    previous?.observer.disconnect();
    previous?.input.abort();
  }

  function captureRow(element: HTMLElement): void {
    clearAnchor();
    const area = scrollAreaRef.value;
    if (!area?.contains(element)) return;
    const row = element.getBoundingClientRect();
    // Virtualization may remove the row from the DOM, so retain its content offset.
    const offset = area.scrollTop + row.top - area.getBoundingClientRect().top;

    const input = new AbortController();
    const observer = new ResizeObserver(() => {
      if (anchor.value?.input !== input) return;
      if (area.clientHeight === 0) {
        clearAnchor();
        return;
      }
      const viewport = area.getBoundingClientRect();
      // If the old position is covered, use the nearest visible edge.
      const top = Math.min(
        Math.max(row.top, viewport.top),
        Math.max(viewport.top, viewport.bottom - row.height),
      );
      area.scrollTo({ top: viewport.top + offset - top, behavior: "instant" });
    });
    anchor.value = { observer, input };
    observer.observe(area);
    for (const event of ["pointerdown", "wheel", "touchstart", "keydown"]) {
      area.ownerDocument.addEventListener(event, clearAnchor, {
        capture: true,
        passive: true,
        signal: input.signal,
      });
    }
  }

  watch(scrollAreaRef, clearAnchor);
  onBeforeUnmount(clearAnchor);

  return { captureRow, clearAnchor, isAnchoring };
}
