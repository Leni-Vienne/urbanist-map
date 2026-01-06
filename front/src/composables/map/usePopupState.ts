import { ref } from "vue";

// AI : State for tracking teleport targets
// AI : This eliminates the need for MutationObservers in PopupContainer
const overlayPopupTarget = ref<HTMLElement | null>(null);
const projectPopupTarget = ref<HTMLElement | null>(null);

export function usePopupState() {
  function setOverlayPopupTarget(element: HTMLElement | null) {
    overlayPopupTarget.value = element;
  }

  function setProjectPopupTarget(element: HTMLElement | null) {
    projectPopupTarget.value = element;
  }

  return {
    overlayPopupTarget,
    projectPopupTarget,
    setOverlayPopupTarget,
    setProjectPopupTarget,
  };
}
