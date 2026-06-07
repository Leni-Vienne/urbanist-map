import { ref, onMounted, onUnmounted } from "vue";

export const MOBILE_BREAKPOINT = 768;

/**
 * Non-reactive viewport check for use outside component setup (services, plain modules) where
 * the reactive `useIsMobile` composable and its resize listener can't run. Single source of truth
 * for the breakpoint so every caller agrees at the boundary.
 */
export function isMobileViewport(): boolean {
  return globalThis.innerWidth <= MOBILE_BREAKPOINT;
}

export function useIsMobile() {
  const isMobile = ref(isMobileViewport());

  function update() {
    isMobile.value = isMobileViewport();
  }

  onMounted(() => {
    globalThis.addEventListener("resize", update);
  });
  onUnmounted(() => {
    globalThis.removeEventListener("resize", update);
  });

  return { isMobile };
}
