# Overlay editing state

`overlayStore` keeps backend snapshots, current tile projections, and local drafts separate. `liveOverlays` is their read-only effective projection; writers use store actions instead of mutating that projection.

- `baselineCorners` and `baselineCaption` hold the backend values, renamed from the wire fields at ingestion. Local edits never overwrite them.
- `ownProposal` contains the current user's open caption/corners proposal. Missing fields are unchanged; `caption: null` clears the caption. Another requester's proposal belongs to the moderation store, never this patch.
- `showApprovedPosition` records the explicit choice to view approved corners. Otherwise, the edit-mode resting position is the user's proposed corners when available, falling back to the baseline. Caption-only proposals keep baseline corners.
- `history` and `redoStack` contain paired corners and image URLs. `history[0]` is the untouched image at the starting position; additional entries are completed edits. `imageUrl` is derived from the active entry, or from the backend filename when no history exists. The filename is source metadata, not a second image draft.
- A history entry's optional `cropRect` identifies its window within the pristine image at `history[0]`. Repeated crops re-encode that original rather than the previous crop.

`overlayStore.commitOverlayEdit` seeds history when needed, clones the corners, skips unchanged entries, and clears redo on a new edit. Cropping commits its pixels and corners together. Undo/redo move history entries without synchronizing extra image or position fields. `resetHistoryBaseline` restores the resting corners and pristine image and clears redo. Approved/suggested previews change the resting choice only when there are no additional history entries or redo steps.

Displayed corners come from `resolveOverlayCorners`: approved baseline in view mode, active edits or the resting position in edit mode, and the selected request's preview in moderation mode. `resolveOverlaySubmissionCorners` reads history then baseline, ignoring display-only moderation previews.

`unsavedState.ts` derives corner changes by comparing the active history entry to the seed, and caption changes by comparing the live caption to `getEditModeDefaultCaption`. Returning to the starting corners is clean even when undo history remains. New local overlays are always unsaved.

The map runtime watches effective overlay state and schedules one frame-coalesced reconciliation pass in `viewportRenderLoop.ts`. It creates/removes map objects and converges their image sources, corners, markers, and edit handles. Gesture-owned entries are skipped: `gestureTransforms` in `mapLayers.ts` owns transient geometry until the gesture commits or is cancelled. Crop application updates the rendered source before releasing that ownership.

`submitDraft` freezes edits through validation, uploads, the backend write, and receipt application. Success ingests backend snapshots and clears submitted draft history; failure retains drafts. Upload bookkeeping survives retries and reuses the uploaded file only while the image URL matches. The lock is released in `finally`; undo history does not survive successful submission.
