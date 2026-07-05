**Overlay Position Management**:

- Position memory persists across mode switches during edit session
- View mode always shows approved corner positions of overlays from database

An overlay's position is tracked in three distinct in-app places plus one server-provided default, each answering a different question.

- Live GL image (`entries` Map in `services/overlay/mapLayers.ts`): the corners actually rendered on the map. `getOverlayImageCorners`/`getCurrentTransform`.
- `overlayObject.baselineCorners`: the immutable backend/approved baseline (the wire `corners` field, renamed at ingest via `overlayWireToData`).
- `overlayObject.history[]` + `redoStack`: powers undo/redo (Ctrl+Z/Y) via `overlayStore.undoHistory`. Each step carries corners + imageUrl (+ optional cropRect). `history[0]` is the seed = the overlay's edit-mode default position; `history.length > 1` means the user has staged (unsubmitted) corner edits.
- `overlayObject.suggestedCorners` (+ `hasPendingChanges`): server state for an overlay with an open change request. It is the **edit-mode default position** for such an overlay (`getEditModeDefaultCorners`), so re-entering edit mode or reloading shows the proposed position consistently.

Caption is symmetric with position: `overlayObject.baselineCaption` (mirror of `baselineCorners`, copied from the wire `caption` at ingest, never overwritten by edits) + `overlayObject.suggestedCaption` (mirror of `suggestedCorners`, the proposed caption of an open change request), with the live edited value on `overlayObject.caption`. `getEditModeDefaultCaption` mirrors `getEditModeDefaultCorners`.

Both staged deltas are **derived** in `utils/unsavedState.ts`, no store: corners via `getStagedCornersDelta` (`current = history.at(-1).corners`, `original = baselineCorners ?? []`, staged ⟺ `history.length > 1`) and caption via `getStagedCaptionDelta` (`current = caption`, `original = baselineCaption`, staged ⟺ `caption !== getEditModeDefaultCaption`). `getStagedOverlayModifications` merges both from `overlayStore.liveOverlays`. Submitting collapses history to the submitted position (`resetHistoryBaseline`) and moves `baselineCaption`/`suggestedCaption` so the staged tests go false; undo history does not survive submission.

`resolveOverlayCorners` (`services/overlay/data.ts`) is the single resolver that picks among suggested/live/history/backend by (purpose x mode x status). It exists because there is no single canonical position source.
