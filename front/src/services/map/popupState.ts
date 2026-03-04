import { ref } from "vue";

// State for tracking teleport targets
// This eliminates the need for MutationObservers in PopupContainer

export const overlayPopupTarget = ref<HTMLElement | null>(null);
export const projectPopupTarget = ref<HTMLElement | null>(null);

export function setOverlayPopupTarget(element: HTMLElement | null) {
  overlayPopupTarget.value = element;
}

export function setProjectPopupTarget(element: HTMLElement | null) {
  projectPopupTarget.value = element;
}
