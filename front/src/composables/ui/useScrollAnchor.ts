import { onBeforeUnmount, watch, type Ref } from "vue";

/** Keep a row in place through layout changes until the next user interaction. */
export function useScrollAnchor(scrollAreaRef: Readonly<Ref<HTMLElement | null>>) {
  let observer: ResizeObserver | null = null;
  let input: AbortController | null = null;

  function clearAnchor(): void {
    observer?.disconnect();
    input?.abort();
    observer = null;
    input = null;
  }

  function captureRow(element: HTMLElement): void {
    clearAnchor();
    const area = scrollAreaRef.value;
    if (!area?.contains(element)) return;
    const row = element.getBoundingClientRect();
    // Virtualization may remove the row from the DOM, so retain its content offset.
    const offset = area.scrollTop + row.top - area.getBoundingClientRect().top;

    observer = new ResizeObserver(() => {
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
    observer.observe(area);
    input = new AbortController();
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

  return { captureRow, clearAnchor };
}
