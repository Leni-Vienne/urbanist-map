import { LngLat, LngLatBounds } from "maplibre-gl";
import { t } from "@/locales";

import { useOverlayStore } from "@/stores/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { getOverlayBounds } from "@/services/overlay/markers";
import * as registry from "@/services/overlay/mapLayers";
import { isValidQuad, parsePointValue, parseQuadValue } from "@/services/overlay/transform";
import { getEditModeRestingCorners } from "@/services/overlay/positionState";
import { openOverlayDetail } from "@/services/overlay/selection";
import { ensureOverlayLoaded } from "@/services/overlay/navigation";
import { mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { buildShapeBounds } from "@/utils/cornersBounds";
import { openProjectDetail } from "@/services/core/projectSelection";
import type { LatLng, Overlay, PendingChangeRequest, Project } from "@/types/index";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { toastError, toastWarn } from "@/services/core/toast";
import { parseShapeCollection } from "@/utils/geojson";

interface PreviewGeometryOptions {
  change: PendingChangeRequest;
  overlayForModeration: Overlay;
  geometryValue: unknown;
  type: "old" | "new";
}

interface PreviewShapesOptions {
  change: PendingChangeRequest;
  project: Project;
  geometryValue: unknown;
  type: "old" | "new";
}

// Parse a change-request geometry value: a single coordinate (centroid) or a 4-corner quad.
function parseGeometry(geometryValue: unknown): LatLng[] {
  const point = parsePointValue(geometryValue);
  if (point) return [point];
  return parseQuadValue(geometryValue) ?? [];
}

// Navigate to position, combining new and previous bounds for a smooth unzoom effect
function navigateToPosition(targetLatLngs: LngLat[], previousBounds: LngLatBounds | null): void {
  const targetBounds = new LngLatBounds();
  for (const pt of targetLatLngs) {
    targetBounds.extend(pt);
  }

  // Extend with previous bounds so both positions stay visible during transition
  if (previousBounds) {
    targetBounds.extend(previousBounds.getSouthWest());
    targetBounds.extend(previousBounds.getNorthEast());
  }

  mobileAwareFlyToBounds(targetBounds);
}

export function getPreviewType(changeId: string): "current" | "suggested" | null {
  const state = useChangeRequestStore().previewState;
  if (state.type === "none" || state.changeId !== changeId) return null;
  return state.type === "current" || state.type === "project-current" ? "current" : "suggested";
}

function applyPositionPreview(
  overlayId: string,
  type: "old" | "new",
  targetCorners: LatLng[],
  wasAlreadyLoaded: boolean,
): void {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.liveOverlays[overlayId];
  if (!overlayObject) return;

  // Capture current bounds before navigating, so the flyTo can show both positions.
  let previousBounds: LngLatBounds | null = null;
  if (wasAlreadyLoaded) {
    previousBounds = getOverlayBounds(overlayObject);
  }

  // In edit mode the toggle moves an unedited overlay's resting position, so its history seed
  // follows it (the first undo returns to the shown position). A staged overlay keeps its edits and
  // undo target. Moderation resolves the preview entirely from changeRequestStore.previewState (the
  // previewed request's own corners), so it never mutates the overlay object. Either way the
  // reconciler converges the image, marker and (in edit mode) the edit handles to the resolved
  // position.
  if (useUiStore().mode === "edit") {
    const isUnedited =
      overlayObject.positionState !== "staged" && overlayObject.redoStack.length === 0;
    if (isUnedited) {
      overlayStore.updateOverlayDraft(overlayId, {
        positionState: type === "new" ? "suggested" : "approved-toggled",
      });
      const restingCorners = getEditModeRestingCorners(
        overlayStore.getOverlayById(overlayId) ?? overlayObject,
      );
      if (isValidQuad(restingCorners)) {
        overlayStore.resetHistoryBaseline(overlayId, restingCorners);
      }
    }
  }

  registry.scheduleOverlayReconcile();

  const targetLatLngs = targetCorners.map((c) => new LngLat(c.lng, c.lat));
  navigateToPosition(targetLatLngs, previousBounds);
}

export async function previewOverlayGeometry(options: PreviewGeometryOptions): Promise<void> {
  const { change, overlayForModeration, geometryValue, type } = options;

  try {
    const corners = parseGeometry(geometryValue);

    if (corners.length === 0) {
      toastWarn(t("overlay.couldNotParseCoordinates"), t("overlay.invalidCoordinates"));
      return;
    }

    const changeRequestStore = useChangeRequestStore();
    const overlayId = overlayForModeration.id;
    const wasAlreadyLoaded = registry.getImageHandle(overlayId) !== null;
    const isTogglingActivePreview =
      changeRequestStore.previewState.type !== "none" &&
      changeRequestStore.previewState.changeId === change.id;

    const overlayStore = useOverlayStore();
    if (useUiStore().mode === "edit" && !overlayStore.hasFullOverlayData(overlayId)) {
      await ensureOverlayLoaded(overlayId);
    }
    if (!overlayStore.liveOverlays[overlayId]) {
      toastError(t("overlay.couldNotLoadOverlay"), t("overlay.loadFailed"));
      return;
    }

    // The effective preview derives from intent × selection, so record the intent and select the
    // overlay before converging: the reconciler resolves the moderation preview position from it.
    changeRequestStore.previewIntent = {
      changeId: change.id,
      side: type === "new" ? "suggested" : "current",
    };
    openOverlayDetail(overlayId);

    // Don't pass previousBounds when toggling, both positions are already visible
    applyPositionPreview(overlayId, type, corners, wasAlreadyLoaded && !isTogglingActivePreview);
  } catch (error) {
    console.error("[changeRequestPreview] Failed to preview geometry:", error);
    toastError(t("overlay.couldNotPreviewCoordinates"), t("overlay.previewFailed"));
  }
}

export async function previewShapes(options: PreviewShapesOptions): Promise<void> {
  const { change, project, geometryValue, type } = options;

  const geometry = parseShapeCollection(geometryValue);
  if (!geometry) {
    toastWarn(t("shapes.noShapesToPreview"));
    return;
  }

  const bounds = buildShapeBounds(geometry);
  if (!bounds) return;

  const changeRequestStore = useChangeRequestStore();
  changeRequestStore.previewIntent = {
    changeId: change.id,
    side: type === "new" ? "suggested" : "current",
  };
  openProjectDetail(project);
  mobileAwareFlyToBounds(bounds);
}
