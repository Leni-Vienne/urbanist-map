**Overlay Position Management**:

- Position memory persists across mode switches during edit session
- View mode always shows approved corner positions of overlays from database

An overlay's position is tracked in several distinct places, each answering a different question. They are intentionally separate and can't be derived from one another.

- Live GL image (`entries` Map in `services/overlay/mapLayers.ts`): the corners actually rendered on the map. `getOverlayImageCorners`/`getCurrentTransform`.
- `overlayObject.baselineCorners`: the immutable backend/approved baseline (the wire `corners` field, renamed at ingest via `overlayWireToData`).
- `overlayObject.history[]` + `redoStack`: powers undo/redo (Ctrl+Z/Y) via `overlayStore.undoHistory`. Each step carries corners + imageUrl (+ optional cropRect).
- `pendingModificationsStore.modifications` (per-overlay, `corners: {current, original}`): the unsubmitted delta, i.e. "this position has not been sent to the server yet". Drives the submission payload and the "has unsaved changes" indicator.

Why `pendingMods.corners` is NOT redundant with `history`: submitting a change request clears the pendingMods delta (it is sent now) but intentionally KEEPS history, so re-entering edit mode still shows the proposed position and undo still works (`useSubmissionService.submitOverlayModification`, the `!isChangeRequest` branch). The two must be able to diverge, so pendingMods cannot be derived from `history.at(-1)`.

`resolveOverlayCorners` (`services/overlay/data.ts`) is the single resolver that picks among live/history/backend by (purpose x mode x status). It exists because there is no single canonical position source.
