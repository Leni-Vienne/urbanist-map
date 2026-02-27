import { useUnsavedChanges } from "@/composables/core/useUnsavedChanges";
import { onMounted, onUnmounted } from "vue";

/**
 * AI : Composable to handle user wanting to close tab/window while there are unsaved overlays
 */
export function useBeforeUnload() {
  const { hasUnsavedChanges } = useUnsavedChanges();

  function checkForModifiedOverlays(): boolean {
    return hasUnsavedChanges();
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (checkForModifiedOverlays()) {
      // AI : Prevent default to trigger browser confirmation dialog
      event.preventDefault();
    }
  }

  onMounted(() => {
    globalThis.addEventListener("beforeunload", handleBeforeUnload);
  });

  onUnmounted(() => {
    globalThis.removeEventListener("beforeunload", handleBeforeUnload);
  });
}
