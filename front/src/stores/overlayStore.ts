import { ref, shallowRef } from 'vue';
import type { OverlayObject } from '@types';

// AI : Central store for overlay data to avoid circular dependencies
export const overlays = shallowRef<Record<string, OverlayObject>>({});
export const idSelectedOverlay = ref<string | null>(null);
export const isEditMode = ref<boolean>(false);

// AI : Replacement overlay functionality
export const replacementOverlayId = ref<string | null>(null);
export const showImageUploadDialog = ref<boolean>(false);

// AI : Request overlay replacement (replaces EventBus functionality)
export function requestOverlayReplacement(overlayId: string) {
  replacementOverlayId.value = overlayId;
  showImageUploadDialog.value = true;
}

// AI : Reset replacement state
export function resetReplacement() {
  replacementOverlayId.value = null;
}