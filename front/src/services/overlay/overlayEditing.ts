// Overlay editing operations

import L from "leaflet";
import { t } from "@/locales";
import { map, currentZoomLevel } from "@/services/core/map";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useAuthStore } from "@/stores/authStore";
import type { OverlayObject, Project } from "@/types/index";
import { createOverlayObject, createProjectObject } from "@/utils/typeFactories";
import { addOverlayToProjectWithId } from "@/services/project/projectMutations";
import { removeStandaloneProjectMarkerForProject } from "@/services/map/standaloneProjectMarkers";
import { useToast } from "@/composables/ui/useToast";
import { selectOverlay } from "@/services/overlay/overlaySelection";
import { recordOverlayModification } from "@/services/overlay/overlayHistory";
import { usePendingModificationsStore } from "@/stores/pinia/pendingModificationsStore";
import {
  updateMarkerPosition,
  updateMarkerTooltip,
  createMarker,
} from "@/services/overlay/overlayMarkers";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { overlayCallbacks } from "@/services/overlay/overlayLifecycle";
import * as registry from "@/services/overlay/overlayRenderRegistry";

/**
 * Update overlay editing state when switching modes.
 * Entering edit mode: restore the user's last edited corners from history.
 * Leaving edit mode: snap the visible layer back to the approved backend corners (history preserved).
 */
export async function updateOverlayEditingState(): Promise<void> {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  const selectedOverlayId = overlayStore.idSelectedOverlay;
  const wasSelected = Boolean(selectedOverlayId);

  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    const layer = registry.getLayer(overlayObject.id);
    if (!layer) return;

    if (!map.value.hasLayer(layer)) return;

    const isEditMode = mapStore.mode === "edit";
    // Only pass mode actions, toolbar UI is handled by OverlayFloatingToolbar.vue.
    // Cast to any[]: L.ResizeRotateAction/DistortAction are registered by leaflet-distortableimage
    // at runtime but absent from TS types.
    const modeActions = (
      isEditMode ? [(L as any).ResizeRotateAction, (L as any).DistortAction] : []
    ) as any[];
    layer.setOptions({ actions: modeActions, draggable: isEditMode });

    // isModified is owned by saveToHistory / undo / submission flows; mode transitions
    // must not write to it (would clobber the cleared state after a submission round-trip).
    if (isEditMode) {
      const lastEdited = overlayObject.history.at(-1);
      const hasUserEdits = overlayObject.history.length > 1;
      if (hasUserEdits && lastEdited?.length === 4) {
        const leafletCorners = lastEdited.map((corner) => L.latLng(corner.lat, corner.lng));
        layer.setCorners(leafletCorners);
        updateMarkerPosition(overlayObject);
      }
    } else if (overlayObject.corners.length === 4) {
      // Leaving edit mode: snap the visible layer back to the approved backend position.
      // History is intentionally preserved so re-entering edit mode restores the user's edits.
      const leafletCorners = overlayObject.corners.map((corner) =>
        L.latLng(corner.lat, corner.lng),
      );
      layer.setCorners(leafletCorners);
      updateMarkerPosition(overlayObject);
    }

    updateMarkerTooltip(overlayObject);
  });

  // Restore selection so editing handles reappear after mode switch.
  if (wasSelected && selectedOverlayId) {
    requestAnimationFrame(() => {
      if (registry.hasReadyLayer(selectedOverlayId)) {
        selectOverlay(selectedOverlayId);
      }
    });
  }
}

// Helper to create a new overlay object
function createNewOverlayObject(id: string, imageUrl: string, projectId: string): OverlayObject {
  // Detect Data URI (local upload) vs Backend URL
  const isDataUri = imageUrl.startsWith("data:");
  const filename = isDataUri ? `pending-${id}.webp` : (imageUrl.split("/").pop() ?? "");
  const authStore = useAuthStore();

  // null = local only, never submitted to backend.
  // Avoid undefined here: the factory promotes undefined to "pending",
  // which then requires authorId === currentUserId to pass visibility checks.
  // null takes the dedicated local-overlay branch in isOverlayVisible and always returns true.
  return createOverlayObject({
    id,
    filename,
    projectId,
    authorId: authStore.user?.id ?? null, // Set to current user's ID
    imageUrl,
    isModified: true, // New overlays need to be uploaded
    status: null, // null = local only, never submitted
  });
}

/**
 * Add a new overlay to the map
 *
 * @param imageUrl
 * @param projectId
 * @param replacesOverlayId
 * @returns the ID of the newly created overlay
 */
export function addOverlay(
  imageUrl: string,
  projectId: string,
  replacesOverlayId?: string,
): string | undefined {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // Only allow adding overlays in edit mode
  if (mapStore.mode !== "edit") {
    return undefined;
  }

  if (!projectId) {
    throw new Error("Project Required: A project must be selected to add an overlay");
  }

  const id = crypto.randomUUID();

  // Create overlay object using proper schema structure
  const overlayObject = createNewOverlayObject(id, imageUrl, projectId);

  // If this is a replacement overlay, set the replacement reference
  if (replacesOverlayId) {
    overlayObject.replacesOverlayId = replacesOverlayId;
    const originalOverlay = overlayStore.overlays[replacesOverlayId];
    overlayObject.caption = `Replacement for ${originalOverlay?.caption ?? "overlay"}`;
  }

  // Check if we need to zoom in to make overlay visible
  const needsZoom =
    currentZoomLevel.value < getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);
  const projectStore = useProjectStore();

  // Fall back to userContributions if not found in the main project store
  let project = projectStore.projects[projectId];
  if (!project) {
    const userContribution = projectStore.userContributions.find((p) => p.id === projectId);
    if (userContribution) {
      project = createProjectObject(userContribution as unknown as Partial<Project>);
    }
  }

  // Async to allow dynamic import of overlayRendering (keeps leaflet-distortableimage out of initial bundle)
  async function createAndSetupOverlay() {
    const { createLeafletOverlay } = await import("@/services/overlay/overlayRendering");
    // onAddedToMap fires after the image has loaded and the layer is confirmed on the map.
    // createLeafletOverlay already registers the layer and waits for the image internally.
    createLeafletOverlay(imageUrl, overlayObject, () => {
      const layer = registry.getLayer(overlayObject.id);
      overlayObject.corners = layer?.getCorners() ?? [];

      overlayStore.addOverlay(id, overlayObject);
      createMarker(overlayObject);

      // Add to project AFTER storing in overlays to avoid "not found" error.
      const isFirstOverlay = addOverlayToProjectWithId(projectId, id);
      if (isFirstOverlay) {
        removeStandaloneProjectMarkerForProject(projectId);
      }
      selectOverlay(id);
    });
  }

  // If zoom level is too low, zoom to project location first, then create overlay
  if (needsZoom && project?.lat && project.lng) {
    const targetZoom = 16;

    // Show toast to inform user about auto-zoom
    const toast = useToast();
    toast.add({
      severity: "info",
      summary: t("overlay.zoomingToProject"),
      detail: t("overlay.zoomInToSeeOverlay"),
      life: 4000,
    });

    mobileAwareFlyTo(L.latLng(project.lat, project.lng), targetZoom);

    // Wait for zoom to complete before creating overlay
    map.value.once("zoomend", () => {
      void createAndSetupOverlay();
    });
  } else {
    void createAndSetupOverlay();
  }

  return id;
}

function undo() {
  applyHistoryAction("undo");
}

function redo() {
  applyHistoryAction("redo");
}

function applyHistoryAction(action: "undo" | "redo") {
  const overlayStore = useOverlayStore();

  if (!overlayStore.idSelectedOverlay) return;

  const overlayObject = overlayStore.overlays[overlayStore.idSelectedOverlay];
  const layer = overlayObject ? registry.getLayer(overlayObject.id) : null;
  if (!overlayObject || !layer) return;

  const { history, redoStack } = overlayObject;
  const isUndo = action === "undo";

  if ((isUndo && history.length <= 1) || (!isUndo && redoStack.length === 0)) {
    return;
  }

  if (isUndo) {
    const currentState = history.pop();
    if (!currentState) return;

    redoStack.push(currentState);
    const previousState = history.at(-1);
    if (!previousState) return;

    layer.setCorners(previousState);

    // Back to initial state on a submitted overlay (approved/pending/rejected) -- mark as
    // unmodified so the marker returns to its status color.
    if (history.length === 1 && overlayObject.status !== null) {
      overlayObject.isModified = false;
    }
  } else {
    const stateToRestore = redoStack.pop();
    if (!stateToRestore) return;

    history.push(stateToRestore);
    layer.setCorners(stateToRestore);

    overlayObject.isModified = true;
  }

  updateMarkerPosition(overlayObject);
  updateMarkerTooltip(overlayObject);

  recordOverlayModification(overlayObject);

  // On full undo to original state, clear corners from pendingModsStore for any submitted
  // overlay (but not caption, which may have its own pending change).
  if (isUndo && history.length === 1 && overlayObject.status !== null) {
    const pendingModsStore = usePendingModificationsStore();
    pendingModsStore.clearFieldModification(overlayObject.id, "corners");
  }
}

// Guard against duplicate keyboard shortcut registration
let keyboardShortcutsRegistered = false;

function handleKeyDown(event: KeyboardEvent) {
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

export function setupKeyboardShortcuts() {
  if (keyboardShortcutsRegistered) return;
  globalThis.addEventListener("keydown", handleKeyDown, true);
  keyboardShortcutsRegistered = true;
}

// Register undo/redo callbacks for overlayToolbar.ts (lazy chunk).
// focusCameraToOverlay is set separately by overlayActions.ts.
Object.assign(overlayCallbacks, { undo, redo });

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
