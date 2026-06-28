import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import {
  highlightProjectShapes,
  unhighlightProjectShapes,
} from "@/services/map/shapeLayerRegistry";
import { setExternalHover } from "@/services/map/vectorHoverState";

/**
 * Lightweight project-outline highlight helpers, kept free of the overlay edit/drag/resize stack
 * so view-mode consumers (visible-projects panel, vector tile layers) don't statically pull it in.
 */

/**
 * Highlight everything related to a project: project shapes, sister overlays, and the
 * vector tile filters (via the external-hover state). Called from sidebar hover,
 * overlay DOM hover, overlay selection, and selection refresh after mode switch.
 */
export function highlightProject(projectId: string, overlayId?: string): void {
  if (!projectId) return;

  setExternalHover(projectId, overlayId ?? null);

  // Project shape layers (standalone project geometry) exist in all modes
  highlightProjectShapes(projectId);
}

/**
 * Remove outlines from all overlays in a project
 * @param projectId - The project whose overlays should have outlines removed
 * @param force - If true, removes outlines even if an overlay in the project is selected
 */
export function removeProjectOutlines(projectId: string, force = false): void {
  const overlayStore = useOverlayStore();

  if (!projectId) return;

  setExternalHover(null);
  if (!force) {
    const selectedOverlay = overlayStore.idSelectedOverlay
      ? overlayStore.overlays[overlayStore.idSelectedOverlay]
      : null;
    if (selectedOverlay?.projectId === projectId) return;

    const uiStore = useUiStore();
    if (uiStore.projectDetail.visible && uiStore.projectDetail.projectId === projectId) return;
  }

  // Unhighlight project shapes alongside the overlays (GeoJSON layers in edit/moderation, vector tiles in view mode)
  unhighlightProjectShapes(projectId);
  refreshSelectionHighlight();
}

/**
 * Returns the projectId that is currently "highlighted" - either because an overlay of
 * that project is selected, or because the project detail (shape click) is open.
 */
export function getCurrentHighlightedProjectId(): string | null {
  const overlayStore = useOverlayStore();
  const uiStore = useUiStore();

  const selected = overlayStore.idSelectedOverlay
    ? overlayStore.overlays[overlayStore.idSelectedOverlay]
    : null;
  return (
    selected?.projectId ?? (uiStore.projectDetail.visible ? uiStore.projectDetail.projectId : null)
  );
}

/**
 * Re-apply the highlight (overlays + shapes) for the currently highlighted project.
 * Call after mode switches so that persisting overlay elements get the correct new-mode color.
 */
export function refreshSelectionHighlight(): void {
  const projectId = getCurrentHighlightedProjectId();
  if (projectId) {
    highlightProject(projectId);
  }
}
