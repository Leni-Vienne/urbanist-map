// Keeps an overlay's desired state in sync across its store and its live map representation.
//
// `applyOverlayBackendFields` is the single write path for backend-owned fields (baseline and
// change-request state): it writes them and pushes their display consequences in the same step.
//
// `revertOverlayFieldModification` reverts a staged field edit (corners or caption) in the store
// and schedules a reconcile. A corners revert collapses history to the resting position (an open
// change request's suggested position, otherwise baseline).
import { useOverlayStore } from "@/stores/overlayStore";
import { useMapStore } from "@/stores/mapStore";
import { scheduleOverlayReconcile } from "@/services/overlay/mapLayers";
import {
  isValidQuad,
  getEditModeRestingCorners,
  reconcilePositionState,
  sameCorners,
} from "@/services/overlay/transform";
import {
  getStagedCornersDelta,
  getStagedCaptionDelta,
  getEditModeDefaultCaption,
} from "@/services/overlay/unsavedState";
import { createOverlayObject } from "@/utils/typeFactories";
import type { ModifiableField, OverlayData, OverlayObject } from "@/types/index";

// Backend-owned fields that define an overlay's default (unedited) position and caption.
type OverlayBackendFields = Partial<
  Pick<
    OverlayObject,
    | "baselineCorners"
    | "baselineCaption"
    | "hasPendingChanges"
    | "suggestedCorners"
    | "suggestedCaption"
  >
>;

// Single write path for backend-owned overlay fields (approved baseline + open change-request
// state). It writes the fields and the store-side consequences (positionState, caption, and an
// unedited overlay's history seed when its resting position changed), then schedules a reconcile;
// the viewport render loop converges the image/marker to the new resolved position. Overlays with
// staged edits or pending redo state keep the user's position and seed.
export function applyOverlayBackendFields(
  overlayObject: OverlayObject,
  fields: OverlayBackendFields,
): void {
  const previousDefaultCaption = getEditModeDefaultCaption(overlayObject);
  const previousRestingCorners = getEditModeRestingCorners(overlayObject);
  const captionWasUntouched = overlayObject.caption === previousDefaultCaption;

  useOverlayStore().updateOverlay(overlayObject.id, fields);
  overlayObject.positionState = reconcilePositionState(overlayObject);

  const newDefaultCaption = getEditModeDefaultCaption(overlayObject);
  if (captionWasUntouched && overlayObject.caption !== newDefaultCaption) {
    overlayObject.caption = newDefaultCaption;
  }

  // Re-seed an unedited overlay's history to the new resting position so its undo target follows a
  // change request arriving/resolving. Staged overlays keep their edits and seed.
  const hasEditState =
    overlayObject.positionState === "staged" || overlayObject.redoStack.length > 0;
  if (!hasEditState && useMapStore().mode === "edit") {
    const restingCorners = getEditModeRestingCorners(overlayObject);
    if (!sameCorners(previousRestingCorners, restingCorners) && isValidQuad(restingCorners)) {
      useOverlayStore().resetHistoryBaseline(overlayObject.id, restingCorners);
    }
  }

  scheduleOverlayReconcile();
}

// Single ingest path for backend-sourced overlay wire data. Produces exactly one canonical
// OverlayObject per id: built once via the factory on first contact, then mutated in place on every
// later delivery, never rebuilt. Returns the canonical (Pinia-reactive) object.
//
// Field precedence by `data.source`: "bbox" wire is authoritative for everything it carries,
// including change-request state; "tile" wire carries no change-request state, so it must never
// write hasPendingChanges/suggestedCorners/suggestedCaption. Both route their backend-owned fields
// through applyOverlayBackendFields so the display consequences (caption advance, resting-position
// snap) ride with the write. An unsaved local crop (imageUrl is a data: URL) survives untouched
// because the existing object is never replaced.
export function upsertOverlayFromWire(data: OverlayData): OverlayObject {
  const overlayStore = useOverlayStore();
  const existing = overlayStore.liveOverlays[data.id];

  if (!existing) {
    const overlayObject = createOverlayObject(data);
    // An untouched caption tracks the edit-mode default (an open change request's suggested caption
    // when present), not the baseline the factory set from the wire caption.
    overlayObject.caption = getEditModeDefaultCaption(overlayObject);
    overlayStore.addOverlay(data.id, overlayObject);
    return overlayStore.liveOverlays[data.id] ?? overlayObject;
  }

  const fields: OverlayBackendFields = {
    baselineCorners: data.baselineCorners,
    baselineCaption: data.baselineCaption,
  };
  if (data.source !== "tile") {
    fields.hasPendingChanges = data.hasPendingChanges;
    fields.suggestedCorners = data.suggestedCorners;
    fields.suggestedCaption = data.suggestedCaption;
  }
  applyOverlayBackendFields(existing, fields);

  // Approved overlays first loaded via vectorTileSync lack project data; attach it when a later
  // (bbox) delivery carries it, so the detail panel can resolve activeProject.
  if (data.project) existing.project = data.project;

  return existing;
}

// Reverts one field of a staged overlay modification (caption or corners), syncing the image
// layer, edit handles, marker and tooltip. Both reverts target the resting position/caption (an
// open change request's suggested value, otherwise the approved baseline). Returns true if the
// overlay's other field is still staged.
export function revertOverlayFieldModification(
  overlayId: string,
  field: ModifiableField,
  overlayObject: OverlayObject,
): boolean {
  if (field === "corners") {
    // Collapse to the resting position (store-only); the reconciler converges the image/marker.
    const restingCorners = getEditModeRestingCorners(overlayObject);
    if (isValidQuad(restingCorners)) {
      useOverlayStore().resetHistoryBaseline(overlayId, restingCorners);
    }
    scheduleOverlayReconcile();
    return getStagedCaptionDelta(overlayObject) !== null; // caption still staged?
  }

  useOverlayStore().updateOverlay(overlayId, {
    caption: getEditModeDefaultCaption(overlayObject),
  });
  return getStagedCornersDelta(overlayObject) !== null; // corners still staged?
}
