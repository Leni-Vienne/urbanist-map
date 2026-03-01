import { ref, onMounted, onUnmounted } from "vue";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const isMobile = ref(globalThis.innerWidth <= MOBILE_BREAKPOINT);

  function update() {
    isMobile.value = globalThis.innerWidth <= MOBILE_BREAKPOINT;
  }

  onMounted(() => globalThis.addEventListener("resize", update));
  onUnmounted(() => globalThis.removeEventListener("resize", update));

  return { isMobile };
}
