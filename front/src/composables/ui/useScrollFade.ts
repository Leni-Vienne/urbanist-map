import { ref, watch, onBeforeUnmount, useTemplateRef } from "vue";

// Sub-pixel slack so fractional scroll metrics still resolve as "at the bottom".
const BOTTOM_EPSILON = 1;

// Requires the scrolling element to carry ref="scrollAreaRef" and its inner wrapper
// ref="contentRef"; both are picked up from the calling component's template.
export function useScrollFade() {
  const scrollAreaRef = useTemplateRef<HTMLElement>("scrollAreaRef");
  const contentRef = useTemplateRef<HTMLElement>("contentRef");
  const showScrollFade = ref(false);

  function updateScrollFade() {
    const el = scrollAreaRef.value;
    if (el) {
      showScrollFade.value = el.scrollHeight - el.clientHeight - el.scrollTop > BOTTOM_EPSILON;
    }
  }

  const scrollObserver = new ResizeObserver(updateScrollFade);

  // Both elements can arrive after mount and be swapped out (a v-if'd scroll area), so the
  // listener and observations follow the refs rather than being bound once.
  function bindScrollArea(el: HTMLElement | null, previous: HTMLElement | null | undefined): void {
    if (previous) {
      scrollObserver.unobserve(previous);
      previous.removeEventListener("scroll", updateScrollFade);
    }
    if (el) {
      scrollObserver.observe(el);
      el.addEventListener("scroll", updateScrollFade, { passive: true });
    }
    updateScrollFade();
  }

  function bindContent(el: HTMLElement | null, previous: HTMLElement | null | undefined): void {
    if (previous) scrollObserver.unobserve(previous);
    if (el) {
      scrollObserver.observe(el);
      updateScrollFade();
    } else {
      showScrollFade.value = false;
    }
  }

  function releaseScrollArea(): void {
    scrollObserver.disconnect();
    scrollAreaRef.value?.removeEventListener("scroll", updateScrollFade);
  }

  watch(scrollAreaRef, bindScrollArea, { immediate: true });
  watch(contentRef, bindContent);

  onBeforeUnmount(releaseScrollArea);

  return { scrollAreaRef, contentRef, showScrollFade };
}
