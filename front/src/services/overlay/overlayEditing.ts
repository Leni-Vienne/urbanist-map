// Overlay editing operations

import { LngLat } from "maplibre-gl";
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
import { createMarker } from "@/services/overlay/overlayMarkers";
import { updateMarkerPosition, updateMarkerTooltip } from "@/services/map/markers";
import { createOverlayImage, setOverlayImageCorners } from "@/services/overlay/overlayImageLayer";
import { transformToCorners } from "@/services/overlay/overlayTransform";
import {
  showEditHandles,
  hideEditHandles,
  refreshEditHandles,
} from "@/services/overlay/overlayEditHandles";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import * as registry from "@/services/overlay/overlayRenderRegistry";

/**
 * Update overlay editing state when switching modes.
 * Entering edit mode: restore the user's last edited corners from history.
 * Leaving edit mode: snap the image back to the approved backend corners (history preserved).
 */
export async function updateOverlayEditingState(): Promise<void> {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();
  const isEditMode = mapStore.mode === "edit";
  const selectedOverlayId = overlayStore.idSelectedOverlay;

  // Clear any stale handles; they are re-shown for the selected overlay below.
  hideEditHandles();

  Object.values(overlayStore.overlays).forEach((overlayObject: OverlayObject) => {
    if (!registry.getImageHandle(overlayObject.id)) return;

    if (isEditMode) {
      const lastEdited = overlayObject.history.at(-1);
      const hasUserEdits = overlayObject.history.length > 1;
      if (hasUserEdits && lastEdited?.length === 4) {
        setOverlayImageCorners(overlayObject.id, lastEdited);
        updateMarkerPosition(overlayObject);
      }
    } else if (overlayObject.corners.length === 4) {
      // Leaving edit mode: snap back to the approved backend position.
      // History is intentionally preserved so re-entering edit mode restores the user's edits.
      setOverlayImageCorners(overlayObject.id, overlayObject.corners);
      updateMarkerPosition(overlayObject);
    }

    updateMarkerTooltip(overlayObject);
  });

  // Re-show handles for the selected overlay after entering edit mode.
  if (isEditMode && selectedOverlayId) {
    const selected = overlayStore.overlays[selectedOverlayId];
    if (selected && registry.getImageHandle(selectedOverlayId)) {
      requestAnimationFrame(() => showEditHandles(selected));
    }
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

// Read an image's aspect ratio (width / height). Falls back to square on failure.
function loadImageAspect(imageUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.addEventListener("load", () => {
      resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1);
    });
    img.addEventListener("error", () => resolve(1));
    img.src = imageUrl;
  });
}

// Place a new overlay as a rectangle centered on the current view, sized from the image aspect.
async function defaultCornersForNewOverlay(
  imageUrl: string,
): Promise<{ lat: number; lng: number }[]> {
  const aspect = await loadImageAspect(imageUrl);
  const center = map.value.getCenter();
  const widthMeters = 100;
  return transformToCorners({
    center: { lat: center.lat, lng: center.lng },
    width: widthMeters,
    height: widthMeters / aspect,
    bearing: 0,
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

  async function createAndSetupOverlay() {
    const corners = await defaultCornersForNewOverlay(imageUrl);
    overlayObject.corners = corners;
    overlayObject.history = [corners.map((c) => ({ lat: c.lat, lng: c.lng }))];

    overlayStore.addOverlay(id, overlayObject);

    const handle = createOverlayImage(overlayObject, corners);
    if (!handle) return;
    registry.setImageHandle(id, handle);

    createMarker(overlayObject);

    // Add to project AFTER storing in overlays to avoid "not found" error.
    const isFirstOverlay = addOverlayToProjectWithId(projectId, id);
    if (isFirstOverlay) {
      removeStandaloneProjectMarkerForProject(projectId);
    }
    selectOverlay(id);
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

    mobileAwareFlyTo(new LngLat(project.lng, project.lat), targetZoom);

    // Wait for zoom to complete before creating overlay
    map.value.once("zoomend", () => {
      void createAndSetupOverlay();
    });
  } else {
    void createAndSetupOverlay();
  }

  return id;
}

export function undo() {
  applyHistoryAction("undo");
}

export function redo() {
  applyHistoryAction("redo");
}

function applyHistoryAction(action: "undo" | "redo") {
  const overlayStore = useOverlayStore();

  if (!overlayStore.idSelectedOverlay) return;

  const overlayObject = overlayStore.overlays[overlayStore.idSelectedOverlay];
  if (!overlayObject || !registry.getImageHandle(overlayObject.id)) return;

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

    setOverlayImageCorners(overlayObject.id, previousState);

    // Back to initial state on a submitted overlay (approved/pending/rejected) -- mark as
    // unmodified so the marker returns to its status color.
    if (history.length === 1 && overlayObject.status !== null) {
      overlayObject.isModified = false;
    }
  } else {
    const stateToRestore = redoStack.pop();
    if (!stateToRestore) return;

    history.push(stateToRestore);
    setOverlayImageCorners(overlayObject.id, stateToRestore);

    overlayObject.isModified = true;
  }

  refreshEditHandles();
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

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
