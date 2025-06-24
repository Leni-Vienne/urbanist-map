import { ref, shallowRef } from 'vue';
import type { OverlayObject } from '@types';

// AI : Central store for overlay data to avoid circular dependencies
export const overlays = shallowRef<Record<string, OverlayObject>>({});
export const idSelectedOverlay = ref<string | null>(null);
export const isEditMode = ref<boolean>(false);