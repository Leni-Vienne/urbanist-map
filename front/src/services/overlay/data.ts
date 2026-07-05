import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useMapStore } from "@/stores/mapStore";
import type {
  OverlayData,
  OverlayObject,
  OverlayHistoryState,
  Project,
  LatLng,
} from "@/types/index";
import { createOverlayObject } from "@/utils/typeFactories";
import { isValidQuad } from "@/services/overlay/transform";
import { getOverlayImageCorners } from "@/services/overlay/mapLayers";

/**
 * Enrich overlay with project data, falling back to moderation store in moderation mode.
 */
export function enrichOverlayWithProject(savedOverlay: OverlayObject): OverlayObject {
  const projectStore = useProjectStore();
  const moderationStore = useModerationStore();
  const mapStore = useMapStore();

  let project: typeof savedOverlay.project | Project = savedOverlay.project ?? null;

  if (!project && savedOverlay.projectId) {
    // First check normal project store
    project = projectStore.projects[savedOverlay.projectId];

    // If not found and in moderation mode, check moderation store
    if (!project && mapStore.mode === "moderation") {
      const modProject = moderationStore.projects.find((p) => p.id === savedOverlay.projectId);
      if (modProject) {
        project = modProject;
      }
    }
  }

  return createOverlayObject({
    ...savedOverlay,
    project: project ?? null,
  });
}

// Single resolver for an overlay's on-map geometry. There is no single canonical position source;
// `purpose` picks the priority order:
//   "image"  (re)creates the raster, so it prefers the remembered/intended position:
//            suggested (open CR default) > history > backend corners > live image.
//   "marker" tracks where the image actually sits, so it prefers the live position:
//            live image > suggested > history > backend corners.
// History is used for the image unless a view-mode approved overlay (which always renders at its
// backend corners), and for the marker only while editing. The suggested position is the edit-mode
// default for an overlay with an open change request. `history` is read off the passed object when
// present (the image path resolves a freshly-built object before it is committed to the store) and
// otherwise looked up by id. Returns null when no source yields a valid 4-corner quad, e.g. a
// render (kind='render'), whose corners are null.
export function resolveOverlayCorners(
  overlay: OverlayData & { history?: OverlayHistoryState[]; isViewingApprovedPosition?: boolean },
  purpose: "image" | "marker",
): LatLng[] | null {
  const mapStore = useMapStore();

  const history = overlay.history ?? useOverlayStore().liveOverlays[overlay.id]?.history ?? [];
  const historyCorners = history.at(-1)?.corners;
  const liveCorners = getOverlayImageCorners(overlay.id);
  const stored = overlay.baselineCorners;

  const historyAllowed =
    purpose === "image"
      ? !(mapStore.mode === "view" && overlay.status === "approved")
      : mapStore.mode === "edit";
  const fromHistory = historyAllowed && isValidQuad(historyCorners) ? historyCorners : null;

  // Edit mode defaults an overlay with an open change request to its suggested position; user
  // edits (history beyond the seed) and the explicit "view approved position" toggle both override.
  const suggestedAllowed =
    mapStore.mode === "edit" &&
    overlay.hasPendingChanges === true &&
    overlay.isViewingApprovedPosition !== true &&
    history.length <= 1;
  const fromSuggested =
    suggestedAllowed && isValidQuad(overlay.suggestedCorners) ? overlay.suggestedCorners : null;

  if (purpose === "marker") {
    if (isValidQuad(liveCorners)) return liveCorners;
    if (fromSuggested) return fromSuggested;
    if (fromHistory) return fromHistory;
    if (isValidQuad(stored)) return stored;
    return null;
  }

  if (fromSuggested) return fromSuggested;
  if (fromHistory) return fromHistory;
  if (isValidQuad(stored)) return stored;
  return liveCorners;
}

// Fold an overlay's in-progress edit state from the previously-stored instance onto a freshly
// built-from-backend object, so a viewport re-render doesn't discard edits. Backend fields on
// `fresh` are kept, except an unsaved local image (a crop's data URL) which carries over so the
// re-rendered overlay keeps the edited pixels.
export function mergeEditState(fresh: OverlayObject, existing: OverlayObject): void {
  fresh.isViewingApprovedPosition = existing.isViewingApprovedPosition;
  fresh.history = [...existing.history];
  fresh.redoStack = [...existing.redoStack];
  // Carry the live edited caption over the freshly-built wire value, so an in-progress caption edit
  // survives a viewport re-render (baselineCaption/suggestedCaption stay from the wire object).
  fresh.caption = existing.caption;
  if (existing.imageUrl.startsWith("data:")) {
    fresh.imageUrl = existing.imageUrl;
    fresh.filename = existing.filename;
  }
}
