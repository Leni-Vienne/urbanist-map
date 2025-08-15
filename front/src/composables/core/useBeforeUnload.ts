import { overlays } from '@composables/overlay/useOverlay';
import { onMounted, onUnmounted } from 'vue';

/**
 * AI : Composable to handle beforeunload event when there are modified overlays
 */
export function useBeforeUnload() {
  function checkForModifiedOverlays(): boolean {
    if (!overlays?.value) return false;
    
    return Object.values(overlays.value).some(overlay => overlay.isModified);
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (checkForModifiedOverlays()) {
      // AI : Standard message for browsers that support custom messages
      const message = 'You have unsaved changes to overlays. Are you sure you want to leave?';
      
      // AI : Set returnValue for older browsers
      event.returnValue = message;
      
      // AI : Return message for modern browsers (though most ignore custom messages now)
      return message;
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