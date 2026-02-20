# `isModified` vs `pendingModsStore` — State Tracking Analysis

**Last updated**: Feb 20, 2026

## The Two Systems

### 1. `isModified` flag

A boolean property on `OverlayObject` and `Project`. Set directly on the object by various services.

**Used for:**

- Marker color (orange = modified in edit mode) — `markerColors.ts`, `markers.ts`
- Tooltip text — `overlayMarkers.ts`
- "Show publish button?" gate — `UnifiedProjectPopup.vue`, `ContributePanel.vue`
- "Leave page?" warning — `useUnsavedChanges.ts`
- "Navigating to new city while unsaved?" guard — `cityMarkers.ts`, `locationNavigation.ts`
- Delete button visibility — `overlayToolbar.ts`
- Edit mode cache decisions (when to save, when to restore) — `overlayEditing.ts`
- Project backend state caching — `uiStore.ts`, `projectStore.ts`

### 2. `pendingModificationsStore`

A Pinia store that tracks structured diffs for overlay changes:

```ts
type PendingOverlayModification = {
  overlayId: string;
  projectId: string | null;
  overlayStatus: ApprovalStatus;
  corners?: { current: LatLng[]; original: LatLng[] };
  caption?: { current: string | null; original: string | null };
};
```

**Used for:**

- Building the submission payload (`buildOverlayModificationChanges` in `useSubmissionDialog.ts`)
- Gating the submission dialog (alongside `isModified`)
- Counting pending mods per project (badge indicators)

**Does NOT track project field changes** — only overlay corners and captions.

---

## Sync Invariant

For overlays that have a backend state (i.e. `status !== null`):

> `isModified === true` **if and only if** `pendingModsStore.hasPendingModifications(id) === true`

The two must always be updated together. Current callsites that do this correctly:

| Event                            | `isModified`            | `pendingModsStore`                              |
| -------------------------------- | ----------------------- | ----------------------------------------------- |
| User moves overlay corners       | `true`                  | `saveCornersChange()`                           |
| User edits caption               | `true`                  | `saveCaptionChange()`                           |
| Undo back to original (approved) | `false`                 | `clearFieldModification('corners')`             |
| After successful submission      | `false`                 | `clearModification()`                           |
| Reset specific field in dialog   | `false` if no remaining | `clearFieldModification()`                      |
| Mode: edit → view                | `false`                 | unchanged (store persists across mode switches) |

---

## Project Field Tracking (Different Mechanism)

Project field changes are NOT tracked in `pendingModsStore`. Instead, `projectStore.originalProjects` stores a full snapshot of the project before the first local edit. Diffs are computed on demand by comparing current fields against the snapshot (used in `EditProjectForm.vue` and `useSubmissionService.ts`).

|                    | Projects (`originalProjects`) | Overlays (`pendingModsStore`) |
| ------------------ | ----------------------------- | ----------------------------- |
| What is stored     | Full project snapshot         | Per-field explicit diffs      |
| Diff computation   | On demand (compare fields)    | Pre-computed on write         |
| New field coverage | Automatic                     | Requires explicit tracking    |

`isModified` on a project is a cheap boolean gate on top — avoids recomputing the full field diff just to decide whether to show the publish button.

---

## Known Limitation

**Undo desync for non-approved overlays**: The full-undo path in `applyHistoryAction` (`overlayEditing.ts`) only clears `isModified` and the store when `status === "approved"`. For `pending` overlays, fully undoing corners does not reset state. This is intentional — pending overlays have no meaningful "original" position to return to.
