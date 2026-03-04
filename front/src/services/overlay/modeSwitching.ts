import { useOverlayStore } from "@/stores/pinia/overlayStore";

/**
 * Switch between view/edit/moderation modes
 * Simplified version - viewport manager handles rendering
 */
export function switchMode(newMode: "view" | "edit" | "moderation"): void {
  const overlayStore = useOverlayStore();

  if (overlayStore.mode === newMode) return;

  overlayStore.mode = newMode;
}
