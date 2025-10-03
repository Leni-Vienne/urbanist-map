import { useOverlayStore } from '@stores/pinia/overlayStore';
import { onMounted, onUnmounted } from 'vue';

/**
 * AI : Composable to handle user wanting to close tab/window while there are unsaved overlays
 */
export function useBeforeUnload() {
  function checkForModifiedOverlays(): boolean {
    const overlayStore = useOverlayStore();
    if (!overlayStore?.overlays) return false;

    return Object.values(overlayStore.overlays).some(overlay => overlay.isModified);
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
    window.addEventListener('beforeunload', handleBeforeUnload);
  });

  onUnmounted(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  return {
    checkForModifiedOverlays
  };
}