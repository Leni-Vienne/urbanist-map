// Overlay editing operations - extracted from useOverlay.ts
// Handles edit mode state management, undo/redo, image ratio fixing, and overlay creation

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
import { addNewOverlayToCityCache } from "@/services/overlay/overlayCityCache";

/**
 * Update overlay editing state based on current mode
 * This function updates existing overlays in-place with new toolbar actions
 * and restores/resets positions based on whether we're entering or leaving edit mode
 */
export async function updateOverlayEditingState(): Promise<void> {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  // No popup save/restore needed: OverlayFloatingToolbar.vue is reactive and persists
  // across mode switches without any leaflet-toolbar DOM rebuild.
  const selectedOverlayId = overlayStore.idSelectedOverlay;
  const wasSelected = Boolean(selectedOverlayId);

  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    const layer = registry.getLayer(overlayObject.id);
    if (!layer) return;

    if (!map.value.hasLayer(layer)) return;

    const isEditMode = mapStore.mode === "edit";
    // Only pass mode actions — toolbar UI is handled by OverlayFloatingToolbar.vue.
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
        // Restore cached corners to overlay
        const leafletCorners = cachedModifications.corners.map((corner) =>
          L.latLng(corner.lat, corner.lng),
        );
        layer.setCorners(leafletCorners);

        // Only initialize history if it's empty (preserve existing undo/redo history)
        if (overlayObject.history.length === 0) {
          overlayObject.history = [cachedModifications.corners];
        }
        overlayObject.isModified = cachedModifications.isModified;

        // Update marker position to match restored corners
        updateMarkerPosition(overlayObject);
      }

      // When leaving edit mode (entering view/moderation mode), FIRST save to cache, THEN reset
    } else {
      // CRITICAL: Save current position to cache BEFORE resetting to backend
      // This fixes the bug where edit→moderation→edit loses the modified position
      // Logic extracted to saveAllOverlaysToCache for usage in mode watcher
      if (overlayObject.isModified || overlayObject.history.length > 1) {
        saveOverlayModificationsToCache(overlayObject);
      }

      // Now reset to backend positions for display
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

    // Update marker color and tooltip
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

// Helper function to create new overlay with proper Drizzle schema structure
function createNewOverlayObject(id: string, imageUrl: string, projectId: string): OverlayObject {
  // Detect Data URI (local upload) vs Backend URL
  const isDataUri = imageUrl.startsWith("data:");
  // For Data URIs, use a temporary safe filename to prevent 431 errors in thumbnail generation
  // For backend URLs, extract the actual filename
  const filename = isDataUri ? `pending-${id}.webp` : (imageUrl.split("/").pop() ?? "");
  const authStore = useAuthStore();

  // Use factory function for consistent object creation
  // status: null indicates a local overlay not yet submitted to backend
  // IMPORTANT: Do NOT use undefined here — the factory promotes undefined to "pending",
  // which then requires authorId === currentUserId to pass visibility checks.
  // null takes the dedicated "local overlay" branch in isOverlayVisible and always returns true.
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

  // Try to find project in multiple store locations
  let project = projectStore.projects[projectId];

  // If not found in projects, check userContributions
  if (!project) {
    const userContribution = projectStore.userContributions.find((p) => p.id === projectId);
    if (userContribution) {
      // User contributions have lat/lng, use them directly
      // Convert using factory to ensure proper Project type (handling extra fields via safe cast)
      project = createProjectObject(userContribution as unknown as Partial<Project>);
    }
  }

  // Function to create and setup the overlay (extracted to be called after zoom if needed)
  // Async to allow dynamic import of overlayRendering (keeps leaflet-distortableimage out of initial bundle)
  async function createAndSetupOverlay() {
    const { createLeafletOverlay } = await import("@/services/overlay/overlayRendering");
    // Create the overlay
    const newOverlay = createLeafletOverlay(imageUrl, overlayObject);
    if (!newOverlay) return;

    // Wait for element to load asynchronously - getElement() returns undefined until added to DOM
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
          overlayObject.corners = newOverlay.getCorners();

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

          // Add new overlay to city cache so it persists across zoom changes
          if (project?.city) {
            addNewOverlayToCityCache(overlayObject, project.city.id);
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
    const targetZoom = 16; // Zoom level high enough to show overlay clearly

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
    // Zoom is already sufficient, create overlay immediately
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
    // For undo: move current state to redo stack and apply previous state
    const currentState = history.pop();
    if (!currentState) return;

    redoStack.push(currentState);
    const previousState = history.at(-1);
    if (!previousState) return;

    layer.setCorners(previousState);

    // If we're back to the initial state (history.length === 1) and overlay is approved, mark as unmodified
    if (history.length === 1 && overlayObject.status === "approved") {
      overlayObject.isModified = false;
    }
  } else {
    // For redo: move state from redo stack to history and apply it
    const stateToRestore = redoStack.pop();
    if (!stateToRestore) return;

    history.push(stateToRestore);
    layer.setCorners(stateToRestore);

    // Redoing any change means the overlay is modified again
    overlayObject.isModified = true;
  }

  // Update marker position and color after undo/redo
  updateMarkerPosition(overlayObject);
  updateMarkerTooltip(overlayObject);

  // Update cache (undo/redo only available in edit mode)
  // No need to call updateOverlayMarkersColors - updateMarkerTooltip already updates icon
  saveOverlayModificationsToCache(overlayObject);

  // After full undo back to original, remove corners from pendingModsStore to stay in sync with isModified=false
  // Only clear corners (not caption), in case the user also has a pending caption change
  if (isUndo && history.length === 1 && overlayObject.status === "approved") {
    const pendingModsStore = usePendingModificationsStore();
    pendingModsStore.clearFieldModification(overlayObject.id, "corners");
  }
}

// Module-level guard to prevent duplicate keyboard shortcut registration across calls
let keyboardShortcutsRegistered = false;

// Handle keyboard shortcuts for undo/redo in edit mode
function handleKeyDown(event: KeyboardEvent) {
  // Undo: Ctrl+Z (works on all keyboard layouts)
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z") {
    undo();
  }
  // Redo: Ctrl+Y (AZERTY) or Ctrl+Shift+Z (QWERTY)
  else if (
    event.ctrlKey &&
    (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))
  ) {
    redo();
  }
}

/**
 * Register global keyboard shortcuts for undo/redo
 * Guard prevents duplicate registration if called multiple times (e.g. on mode switch)
 */
export function setupKeyboardShortcuts() {
  if (keyboardShortcutsRegistered) return;
  globalThis.addEventListener("keydown", handleKeyDown, true);
  keyboardShortcutsRegistered = true;
}

// Register undo/redo callbacks - overlayToolbar.ts (lazy chunk) reads these at call time
// focusCameraToOverlay is already set in overlayCallbacks by overlayActions.ts, so not overwritten here.
Object.assign(overlayCallbacks, { undo, redo });

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
