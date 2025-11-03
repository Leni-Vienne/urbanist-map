import { ref } from 'vue';

// AI : State machine for position preview
// AI : Extracted to separate file to avoid circular dependency between
// AI : useChangeRequestPreview.ts <-> useOverlayModes.ts
export type PreviewState =
  | { type: 'none' }
  | { type: 'current'; changeId: string; overlayId: string }
  | { type: 'suggested'; changeId: string; overlayId: string; corners: { lat: number; lng: number }[] };

export const previewState = ref<PreviewState>({ type: 'none' });

/**
 * AI : Clear preview state (standalone function, can be called outside composable context)
 * AI : This is safe because it only mutates module-level state without using composable features
 */
export function clearChangeRequestPreview(): void {
  previewState.value = { type: 'none' };
}
