import { ref } from "vue";

// AI : ============================================================================
// AI : POPUP STATE SERVICE - Teleport targets for overlay and project popups
// AI : ============================================================================
// AI : State for tracking teleport targets
// AI : This eliminates the need for MutationObservers in PopupContainer
// AI : ============================================================================

export const overlayPopupTarget = ref<HTMLElement | null>(null);
export const projectPopupTarget = ref<HTMLElement | null>(null);

export function setOverlayPopupTarget(element: HTMLElement | null) {
  overlayPopupTarget.value = element;
}

export function setProjectPopupTarget(element: HTMLElement | null) {
  projectPopupTarget.value = element;
}
