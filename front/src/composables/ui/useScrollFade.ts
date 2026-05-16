import { ref, watch, onMounted, onActivated, onBeforeUnmount, type Ref } from "vue";

export function useScrollFade(
  scrollAreaRef: Ref<HTMLElement | null>,
  contentRef: Ref<HTMLElement | null>,
) {
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

  return { isScrollable };
}
