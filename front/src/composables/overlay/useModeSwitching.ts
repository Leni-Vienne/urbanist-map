// AI : Mode switching utility - extracted from useOverlayModes.ts
import { useOverlayStore } from "@/stores/pinia/overlayStore";

/**
 * AI : Switch between view/edit/moderation modes
 * AI : Simplified version - viewport manager handles rendering
 */
export function switchMode(newMode: "view" | "edit" | "moderation"): void {
  const overlayStore = useOverlayStore();

  if (overlayStore.mode === newMode) return;

  overlayStore.mode = newMode;
  // AI : Viewport manager watch will trigger refresh automatically
}
