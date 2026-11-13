import { LngLatBounds } from "maplibre-gl";
import { t } from "@/locales";
import { useOverlayStore } from "@/stores/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { useFocusStore } from "@/stores/focusStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { getMapOrNull } from "@/services/core/map";
import { loadOrNull } from "@/services/core/errorHandling";
import { getOverlayBounds } from "@/services/overlay/markers";
import { getImageHandle } from "@/services/overlay/mapLayers";
import { parsePointValue, parseQuadValue } from "@/services/overlay/transform";
import { openOverlayDetail } from "@/services/overlay/selection";
import { ensureOverlayLoaded } from "@/services/overlay/navigation";
import { mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { buildShapeBounds } from "@/utils/cornersBounds";
import { openProjectDetailById } from "@/services/core/projectSelection";
import type { PendingChangeRequest } from "@/types/index";
import { toastError, toastWarn } from "@/services/core/toast";

export async function previewGeometry(
  change: PendingChangeRequest,
  type: "old" | "new",
): Promise<void> {
  const side = type === "old" ? "current" : "suggested";
  const changes = useChangeRequestStore();

  if (change.entityType === "project" && change.fieldName === "geometry") {
    const geometry = type === "old" ? change.oldValue : change.newValue;
    if (!geometry || geometry.geometries.length === 0) {
      toastWarn(t("shapes.noShapesToPreview"));
      return;
    }
    const bounds = buildShapeBounds(geometry);
    if (!bounds) return;
    changes.previewIntent = { changeId: change.id, side };
    openProjectDetailById(change.entityId);
    mobileAwareFlyToBounds(bounds);
    return;
  }
  if (
    change.entityType !== "overlay" ||
    (change.fieldName !== "corners" && change.fieldName !== "centroid")
  )
    return;

  const value = type === "old" ? change.oldValue : change.newValue;
  const point = parsePointValue(value);
  const corners = point ? [point] : parseQuadValue(value);
  if (!corners) {
    toastWarn(t("overlay.couldNotParseCoordinates"), t("overlay.invalidCoordinates"));
    return;
  }

  const isCurrent = useFocusStore().beginNavigation();
  const mode = useUiStore().mode;
  const target = getMapOrNull();
  const overlays = useOverlayStore();
  const overlayId = change.entityId;
  const wasRendered = getImageHandle(overlayId) !== null;
  const isToggling = changes.previewState?.change.id === change.id;
  const loaded =
    mode === "edit"
      ? await loadOrNull(() => ensureOverlayLoaded(overlayId))
      : overlays.liveOverlays[overlayId];
  if (!isCurrent() || !target || useUiStore().mode !== mode || getMapOrNull() !== target) return;
  const overlay = loaded && overlays.liveOverlays[overlayId];
  if (!overlay) {
    toastError(t("overlay.couldNotLoadOverlay"), t("overlay.loadFailed"));
    return;
  }

  try {
    // Capture the displayed bounds before changing intent or the edit position.
    const bounds = wasRendered && !isToggling ? getOverlayBounds(overlay) : null;
    const targetBounds = bounds ?? new LngLatBounds();
    for (const corner of corners) targetBounds.extend(corner);

    // Toggling an untouched edit position also changes where the first undo returns.
    // Staged edits and their redo history keep their own position.
    if (mode === "edit" && overlay.history.length <= 1 && overlay.redoStack.length === 0) {
      overlays.updateOverlayDraft(overlayId, {
        showApprovedPosition: side === "current",
      });
      overlays.resetHistoryBaseline(overlayId);
    }
    changes.previewIntent = { changeId: change.id, side };
    openOverlayDetail(overlayId);
    mobileAwareFlyToBounds(targetBounds);
  } catch (error) {
    console.error("[changeRequestPreview] Failed to preview geometry:", error);
    toastError(t("overlay.couldNotPreviewCoordinates"), t("overlay.previewFailed"));
  }
}
