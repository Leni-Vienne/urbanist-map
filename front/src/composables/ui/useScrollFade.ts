import { ref, watch, onMounted, onActivated, onBeforeUnmount, type Ref } from "vue";

// Sub-pixel slack so fractional scroll metrics still resolve as "at the bottom".
const BOTTOM_EPSILON = 1;

export function useScrollFade(
  scrollAreaRef: Ref<HTMLElement | null>,
  contentRef: Ref<HTMLElement | null>,
) {
  const showScrollFade = ref(false);

  function updateScrollFade() {
    const el = scrollAreaRef.value;
    if (el) {
      showScrollFade.value = el.scrollHeight - el.clientHeight - el.scrollTop > BOTTOM_EPSILON;
    }
  }

  const scrollObserver = new ResizeObserver(updateScrollFade);

  onMounted(() => {
    const el = scrollAreaRef.value;
    if (el) {
      scrollObserver.observe(el);
      el.addEventListener("scroll", updateScrollFade, { passive: true });
    }
    updateScrollFade();
  });

  onActivated(updateScrollFade);

  onBeforeUnmount(() => {
    scrollObserver.disconnect();
    scrollAreaRef.value?.removeEventListener("scroll", updateScrollFade);
  });

  watch(contentRef, (el, oldEl) => {
    if (oldEl) scrollObserver.unobserve(oldEl);
    if (el) {
      scrollObserver.observe(el);
      updateScrollFade();
    } else {
      showScrollFade.value = false;
    }
  });

  return { showScrollFade };
}
