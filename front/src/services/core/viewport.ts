import { ref } from "vue";

const MOBILE_BREAKPOINT = 768;

const mobileQuery = globalThis.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);

// Singleton viewport size class: one media-query listener feeds every consumer,
// component or plain module alike.
export const isMobile = ref(mobileQuery.matches);

function onMobileQueryChange(event: MediaQueryListEvent): void {
  isMobile.value = event.matches;
}

mobileQuery.addEventListener("change", onMobileQueryChange);
