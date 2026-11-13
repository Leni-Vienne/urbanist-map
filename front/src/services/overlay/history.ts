import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import { getImageHandle, isGestureOwned } from "@/services/overlay/mapLayers";
import { isTypingTarget } from "@/utils/keyboard";
import { useUiStore } from "@/stores/uiStore";

export function undo() {
  applyHistoryAction("undo");
}

export function redo() {
  applyHistoryAction("redo");
}

function applyHistoryAction(action: "undo" | "redo") {
  if (useUiStore().mode !== "edit") return;

  const overlayStore = useOverlayStore();

  const id = useFocusStore().selectedOverlayId;
  if (!id || !getImageHandle(id) || isGestureOwned(id)) return;

  if (action === "undo") overlayStore.undoHistory(id);
  else overlayStore.redoHistory(id);
}

function handleKeyDown(event: KeyboardEvent) {
  // Let the browser's native undo/redo win while typing in a field, otherwise the global
  // capture-phase handler would also revert the selected overlay's position.
  if (isTypingTarget(event.target)) return;

  // Ctrl+Z
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z") {
    undo();
    // Ctrl+Y (AZERTY) or Ctrl+Shift+Z (QWERTY)
  } else if (
    event.ctrlKey &&
    (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))
  ) {
    redo();
  }
}

/** Document-level undo/redo shortcuts. */
export function initializeKeyboardShortcuts(): void {
  globalThis.addEventListener("keydown", handleKeyDown, true);
}
