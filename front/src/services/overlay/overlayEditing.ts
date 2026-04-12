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
import { saveOverlayModificationsToCache } from "@/services/overlay/overlayHistory";
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
 * Restores cached positions when entering edit mode; saves and resets to backend positions when leaving.
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

    // When entering edit mode, restore cached corner positions if they exist
    if (isEditMode) {
      const cachedModifications = overlayStore.getFromEditModeCache(overlayObject.id);
      if (cachedModifications?.corners.length === 4) {
        const leafletCorners = cachedModifications.corners.map((corner) =>
          L.latLng(corner.lat, corner.lng),
        );
        layer.setCorners(leafletCorners);

        if (overlayObject.history.length === 0) {
          overlayObject.history = [cachedModifications.corners];
        }
        overlayObject.isModified = cachedModifications.isModified;

        updateMarkerPosition(overlayObject);
      }

      // When leaving edit mode, FIRST save to cache, THEN reset to backend positions.
    } else {
      // Save current position to cache before resetting -- prevents losing the modified position
      // when switching edit→moderation→edit.
      if (overlayObject.isModified || overlayObject.history.length > 1) {
        saveOverlayModificationsToCache(overlayObject);
      }

      if (overlayObject.corners.length === 4) {
        const leafletCorners = overlayObject.corners.map((corner) =>
          L.latLng(corner.lat, corner.lng),
        );
        layer.setCorners(leafletCorners);
        overlayObject.isModified = false;

        // Update marker position to match backend corners
        updateMarkerPosition(overlayObject);
      }
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

/**
 * Save all modified overlays to edit mode cache
 * Used before mode switches or bulk updates to prevent data loss
 */
export function saveAllOverlaysToCache(forceMode?: "edit") {
  const overlayStore = useOverlayStore();
  Object.values(overlayStore.overlays).forEach((overlayObject) => {
    if (overlayObject.isModified || overlayObject.history.length > 1) {
      saveOverlayModificationsToCache(overlayObject, forceMode);
    }
  });
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
    const newOverlay = createLeafletOverlay(imageUrl, overlayObject);
    if (!newOverlay) return;

    // getElement() returns undefined until the image is added to the DOM
    const waitForElement = () => {
      const element = newOverlay.getElement();
      if (!element) {
        // Element not ready yet, try again on next frame
        requestAnimationFrame(waitForElement);
        return;
      }

      L.DomEvent.on(element, "load", () => {
        if (element.complete && element.naturalWidth > 0) {
          registry.setLayer(overlayObject.id, newOverlay);
          overlayObject.corners = newOverlay.getCorners() ?? [];

          // Store reference and initialize with proper reactivity
          overlayStore.addOverlay(id, overlayObject);

          // Create marker with appropriate color based on replacement status
          createMarker(overlayObject);

          // Add to project AFTER storing in overlays to avoid "not found" error
          const isFirstOverlay = addOverlayToProjectWithId(projectId, id);

          // Remove standalone project marker when first overlay is added to project
          if (isFirstOverlay) {
            removeStandaloneProjectMarkerForProject(projectId);
          }

          // Automatically select the newly created overlay for immediate positioning
          selectOverlay(id);
        }
      });
    };

    // Start waiting for element to be ready
    waitForElement();
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

    mobileAwareFlyTo(L.latLng(project.lat, project.lng), targetZoom, {
      duration: 1.5,
      easeLinearity: 0.25,
    });

    // Wait for zoom to complete before creating overlay
    map.value.once("zoomend", () => {
      createAndSetupOverlay();
    });
  } else {
    createAndSetupOverlay();
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

    // Back to initial state on an approved overlay -- mark as unmodified
    if (history.length === 1 && overlayObject.status === "approved") {
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

  saveOverlayModificationsToCache(overlayObject);

  // On full undo to original state, clear corners from pendingModsStore
  // (but not caption, which may have its own pending change)
  if (isUndo && history.length === 1 && overlayObject.status === "approved") {
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
