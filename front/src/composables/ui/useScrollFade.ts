import { ref, watch, onMounted, onActivated, onBeforeUnmount } from "vue";

export function useScrollFade() {
  const scrollAreaRef = ref<HTMLElement | null>(null);
  const contentRef = ref<HTMLElement | null>(null);
  const isScrollable = ref(false);

  function updateScrollable() {
    const el = scrollAreaRef.value;
    if (el) isScrollable.value = el.scrollHeight > el.clientHeight;
  }

  const scrollObserver = new ResizeObserver(updateScrollable);

  onMounted(() => {
    if (scrollAreaRef.value) scrollObserver.observe(scrollAreaRef.value);
    updateScrollable();
  });

  onActivated(updateScrollable);

  onBeforeUnmount(() => scrollObserver.disconnect());

  watch(contentRef, (el, oldEl) => {
    if (oldEl) scrollObserver.unobserve(oldEl);
    if (el) {
      scrollObserver.observe(el);
      updateScrollable();
    } else {
      isScrollable.value = false;
    }
  });

  return { scrollAreaRef, contentRef, isScrollable };
}
