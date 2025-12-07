import { useOverlayStore } from '@/stores/pinia/overlayStore';
import { onMounted, onUnmounted } from 'vue';

/**
 * AI : Composable to handle user wanting to close tab/window while there are unsaved overlays
 */
export function useBeforeUnload() {
  function checkForModifiedOverlays(): boolean {
    const overlayStore = useOverlayStore();
    if (overlayStore?.overlays == null) return false;

    return Object.values(overlayStore.overlays).some(overlay => overlay.isModified === true);
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (checkForModifiedOverlays()) {
      // AI : Prevent default to trigger browser confirmation dialog
      event.preventDefault();
      
      // AI : Modern browsers ignore custom messages and show their own dialog
      return '';
    }
  }

  onMounted(() => {
    globalThis.addEventListener('beforeunload', handleBeforeUnload);
  });

  onUnmounted(() => {
    globalThis.removeEventListener('beforeunload', handleBeforeUnload);
  });

  return {
    checkForModifiedOverlays
  };
}