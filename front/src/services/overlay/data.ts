import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useMapStore } from "@/stores/mapStore";
import type {
  OverlayData,
  OverlayObject,
  OverlayHistoryState,
  OverlayPositionState,
  Project,
  LatLng,
} from "@/types/index";
import { isValidQuad, parseQuadValue } from "@/services/overlay/transform";
import { getOverlayImageCorners } from "@/services/overlay/mapLayers";
import { useChangeRequestStore } from "@/stores/changeRequestStore";

/**
 * Resolve and attach the overlay's project in place, falling back to the moderation store in
 * moderation mode. Mutates the canonical object (no rebuild) and returns it, so callers reading
 * overlay.project (marker color/tooltip, detail panel) see the resolved value.
 */
export function enrichOverlayWithProject(savedOverlay: OverlayObject): OverlayObject {
  if (savedOverlay.project || !savedOverlay.projectId) return savedOverlay;

  const projectStore = useProjectStore();
  let project: Project | null = projectStore.projects[savedOverlay.projectId] ?? null;

  if (!project && useMapStore().mode === "moderation") {
    const moderationStore = useModerationStore();
    project = moderationStore.projects.find((p) => p.id === savedOverlay.projectId) ?? null;
  }

  if (project) savedOverlay.project = project;
  return savedOverlay;
}

// The corners an active moderation suggested-position preview shows for this overlay: the
// previewed change request's own proposed geometry, read off the request rather than any field on
// the overlay object. Null when no suggested-position preview targets the overlay or the request's
// value is not a valid quad.
function getModerationPreviewCorners(overlayId: string): LatLng[] | null {
  const preview = useChangeRequestStore().previewState;
  if (preview.type !== "suggested" || preview.overlayId !== overlayId) return null;
  const change = useModerationStore().changeRequests.find((cr) => cr.id === preview.changeId);
  return parseQuadValue(change?.newValue);
}

// Single resolver for an overlay's on-map geometry. There is no single canonical position source;
// `purpose` picks the priority order:
//   "image"  (re)creates the raster, so it prefers the remembered/intended position:
//            suggested (open CR default) > history > backend corners > live image.
//   "marker" tracks where the image actually sits, so it prefers the live position:
//            live image > suggested > history > backend corners.
// History is used for the image unless a view-mode approved overlay (which always renders at its
// backend corners), and for the marker only while editing. The suggested position is the edit-mode
// default for an overlay with an open change request, and the moderation display while an explicit
// suggested-position preview targets it. `history` is read off the passed object when
// present (the image path resolves a freshly-built object before it is committed to the store) and
// otherwise looked up by id. Returns null when no source yields a valid 4-corner quad, e.g. a
// render (kind='render'), whose corners are null.
export function resolveOverlayCorners(
  overlay: OverlayData & { history?: OverlayHistoryState[]; positionState?: OverlayPositionState },
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

  // Edit mode renders an overlay at its suggested position only while its state rests there; staged
  // edits and the explicit "view approved position" toggle move it to other position states.
  // Moderation renders the previewed change request's own corners while an explicit
  // suggested-position preview targets the overlay.
  let fromSuggested: LatLng[] | null = null;
  if (mapStore.mode === "edit") {
    if (overlay.positionState === "suggested" && isValidQuad(overlay.suggestedCorners)) {
      fromSuggested = overlay.suggestedCorners;
    }
  } else if (mapStore.mode === "moderation") {
    fromSuggested = getModerationPreviewCorners(overlay.id);
  }

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
