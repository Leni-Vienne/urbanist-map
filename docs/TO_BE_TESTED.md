# Frontend Testing Specification (Playwright)

Sections are grouped by feature area:

1. Base Map & Vector Tiles
2. Overlay Loading & Viewport Rendering
3. Mode Switching & Content Visibility
4. Edit Mode
5. Markers & Standalone Projects
6. Panels & Navigation
7. Filtering
8. Tile Layers (Plan / Satellite)
9. Moderation & Admin
10. Auth & Account

## 1. Base Map & Vector Tiles

### 1.1. MapLibre Always-On Base Map

- **Scenario**: Page loads for the first time.
- **Checks**:
  1. The MapLibre liberty-style base map renders immediately on page load with no fallback flash.
  2. The satellite layer switcher still works correctly alongside MapLibre.

### 1.2. MVT Tile Endpoint

- **Scenario**: The `/api/tiles/projects/:z/:x/:y` endpoint returns valid MVT binary data.
- **Steps**:
  1.  Request a tile for a known location with approved projects that have geometry (e.g. `/api/tiles/projects/12/2064/1401`).
  2.  **Check**: Response `Content-Type` is `application/x-protobuf`.
  3.  **Check**: Response body is non-empty binary.
  4.  **Check**: Decode the MVT, verify it contains a `project-shapes` layer with features.
  5.  **Check**: Decode the MVT, verify it contains an `overlay-footprints` layer with features for tiles covering approved overlays.
  6.  Request a tile over an area with no projects. **Check**: Response is `204 No Content`.
  7.  Request with invalid coordinates (e.g. `z=-1`). **Check**: Response is `400`.

### 1.4. Vector Tile Line Styling by Tag

- **Scenario**: Vector lines are styled from the first project tag in MVT, and proposed timeline items are dashed.
- **Steps**:
  1.  Load a zone with approved project geometries and overlays at zoom level where vector lines are visible.
  2.  Confirm at least one project where `first_tag` is one of: `tram`, `rail`, `subway`, `bus`, `bike`, `road`, `bridge`, `waterway`, `park`, `building`.
  3.  Confirm at least one project with `proposal_date` set and `start_date` empty.
- **Checks**:
  1.  Project shape lines use the color mapped to the feature `first_tag`.
  2.  Overlay footprint lines use the same tag-based color mapping as their project.
  3.  Lines with `is_proposed = 1` render with a dashed stroke.
  4.  Lines without `is_proposed` (or `false`) render as solid.
  5.  Unknown or empty `first_tag` values fall back to the default blue color.

### 1.5. Project Point Color by First Tag

- **Scenario**: Single project points use the same color palette as `projectTags`.
- **Steps**:
  1.  Load an area where individual project points are visible (non-image zoom range).
  2.  Confirm points with different first tags (e.g. `tram`, `rail`, `bike`).
  3.  Find a zoom/area where a cluster contains a single project (`point_count = 1`).
- **Checks**:
  1.  Unclustered project points use the color mapped from `front/src/config/projectTags.ts` for `first_tag`.
  2.  A cluster circle with `point_count = 1` uses that same project color.
  3.  Unknown or missing first tag falls back to the default color.

### 1.6. Vector Hover and Click Behavior

- **Scenario**: Testing interactions with vector layers.
- **Steps**:
  1.  Open the map in View mode where vector layers are available.
  2.  Zoom to level 4+ where `project-shapes` lines are visible.
  3.  Zoom to level 14+ where `overlay-footprints` lines are visible.
  4.  Move the mouse slowly across vector lines and then over empty map areas.
  5.  Click a project shape line, then click an overlay footprint line.
- **Checks**:
  1.  On vector hover, cursor changes to pointer and a white highlight outline appears only on the hovered feature.
  2.  Leaving vector features clears the highlight and resets cursor.
  3.  Clicking a `project-shapes` feature opens the project detail panel for the feature id.
  4.  Clicking an `overlay-footprints` feature opens the project detail panel for its `project_id`.
  5.  Clicking on a cluster zooms/expands the cluster (cluster interaction is not regressed).
  6.  In areas where both relation and way features overlap, hover/click resolves to the relation feature when relation metadata is present (`relation_id` or `osm_type=relation`).

### 1.7. Center Marker Handover to Shape and Overlay Image

- **Scenario**: A project's center marker is retired by whatever renders in its place.
- **Steps**:
  1.  In View mode, find a project with no geometry and one approved `map` overlay.
  2.  Zoom from z11 to z14 over it.
  3.  Repeat with a no-geometry project that has no approved overlay.
  4.  Repeat over a grid cell where a cluster marker (count label) contains an overlay-bearing project.
- **Checks**:
  1.  The marker is present below z13 (z12 on a ≤768px viewport) and gone from z13 (z12 on mobile) up, where the overlay image and its footprint border render instead.
  2.  The no-overlay project keeps its marker at every zoom, including past z15.
  3.  The cluster marker is unaffected and still expands on click.
  4.  Switching to Edit or Moderation mode brings the marker back; returning to View retires it again.
  5.  With the "only projects with images" filter on, View mode at z13+ shows overlay images and no lone markers.

## 2. Overlay Loading & Viewport Rendering

### 2.1. Viewport Path, Full Overlay Rendering

### 2.2. Viewport Bounds Check

- **Scenario**: Only overlays within the viewport bounds are rendered.
- **Steps**:
  1.  Load a city at high zoom.
  2.  Position map so some overlays are outside viewport.
  3.  **Check**: Only overlays within viewport bounds are added to map.
  4.  **Check**: Off-screen overlays don't trigger image fetch.
  5.  Pan to reveal off-screen overlays.
  6.  **Check**: Newly visible overlays fetch and render correctly.

### 2.3. Viewport Pruning During Pan

- **Scenario**: Off-screen overlays are progressively removed during panning.
- **Steps**:
  1.  Navigate to an overlay.
  2.  Pan significantly to move the overlay off-screen.
  3.  **Check**: Off-screen overlay images are removed.
  4.  **Check**: In edit mode, markers for off-screen overlays are removed.
  5.  **Regression**: Pan back to original location.
  6.  **Check**: Overlays re-render correctly when returning to viewport.

### 2.4. Progressive Overlay Loading Without Frame Drops

- **Scenario**: Overlays load progressively in batches when entering a dense viewport, without freezing.
- **Steps**:
  1.  Zoom out to view level (low zoom).
  2.  Zoom in rapidly to a dense area (e.g., city center with 50+ overlays).
  3.  **Check**: Overlays appear progressively in chunks (no single giant stall, no slow one-by-one trickle).
  4.  **Check**: Map remains responsive during loading (can pan/zoom).
  5.  **Check**: No browser freezing or stuttering.
  6.  **Regression**: Monitor browser DevTools Performance panel.
  7.  **Check**: No major frame drops during overlay creation.

### 2.5. Deferred Overlay Rendering and Fetching During Flight

- **Scenario**: Map flight animations remain smooth by deferring overlay fetching and rendering until the flight completes.
- **Steps**:
  1.  From a high zoom level, navigate to a different city via the "Latest Contributions" panel.
  2.  Watch the flight animation and monitor the network tab during it.
  3.  **Check**: Flight animation is smooth (60fps or close).
  4.  **Check**: Overlay image requests only start AFTER the flight completes.
  5.  **Check**: Overlay images only appear AFTER the flight completes.
  6.  **Check**: Overlays within viewport are fetched and rendered after arrival.

### 2.6. Current Location & Zoom Oscillation

- **Scenario**: User gets lost and clicks "My Location".
- **Steps**:
  1.  Zoom out to world view.
  2.  Click "My Location" (simulated geolocation).
  3.  **Check**: Map centers on user.
  4.  **Regression**: Verify local overlays render correctly. (Previous bug: jumping from low zoom to high zoom caused the renderer to miss the "add images" event).

### 2.7. Reliable First Load Rendering

- **Scenario**: Overlays render correctly on first load even with cache disabled and slow network.
- **Steps**:
  1.  Clear browser cache.
  2.  Disable cache in DevTools.
  3.  Enable network throttling (Slow 3G).
  4.  Load a city with overlays at high zoom.
  5.  **Check**: All overlays render correctly on first load.
  6.  **Regression**: Repeat test 5-10 times to verify reliability.

### 2.8. Fast Cached Image Loading

- **Scenario**: Overlays render correctly when images load quickly from browser cache.
- **Steps**:
  1.  Load overlays to warm cache.
  2.  Refresh and load same city/overlays.
  3.  **Check**: Overlays render correctly with cached images.
  4.  **Check**: No console errors about image load handlers.

### 2.9. Graceful Cleanup During Load

- **Scenario**: Overlays are cleanly removed when map interactions occur before image loading completes.
- **Steps**:
  1.  Navigate to load overlays.
  2.  Immediately zoom out or switch mode before images finish loading.
  3.  **Check**: No crashes or console errors.
  4.  **Check**: Image load events are properly cleaned up.

### 2.10. Reconcile Queued Before Map Teardown

- **Scenario**: A pending overlay reconcile cannot affect a replacement map instance.
- **Steps**:
  1.  In Edit Mode, make an overlay change that schedules reconciliation, such as undo, redo, or toggling its suggested position.
  2.  Immediately navigate from Home to a non-map route before the next animation frame.
  3.  Return to Home after the new route has rendered.
- **Checks**:
  1.  No console error references a removed MapLibre instance.
  2.  The returned map renders the overlay once at the position derived from the retained store state.
  3.  No duplicate image layer, marker, or edit-handle set is created.

## 3. Mode Switching & Content Visibility

### 3.1. Pending Overlays and Markers Hide in View Mode

- **Scenario**: Pending overlays (images AND markers) are properly hidden when switching from Moderation to View mode.
- **Steps**:
  1.  Enter **Moderation Mode**.
  2.  Zoom to load overlays.
  3.  Verify pending overlay images and markers are visible on map.
  4.  Switch to **View Mode**.
  5.  **Check**: All pending overlay images are removed from map.
  6.  **Check**: Pending markers are removed too (not just images).
  7.  **Check**: Only approved overlays remain visible.
  8.  Switch to **Edit Mode**.
  9.  **Check**: Your own pending markers reappear along with their images.

### 3.2. Pending Overlays Remain Hidden During Zoom and Pan

- **Scenario**: Pending overlays stay hidden during zoom operations in View Mode.
- **Steps**:
  1.  Load a city in **Moderation Mode**.
  2.  Switch to **View Mode**.
  3.  Zoom out and then zoom in.
  4.  **Check**: Pending overlays do NOT reappear.
  5.  **Regression**: Pan around the city area.
  6.  **Check**: Pending overlays remain hidden.

### 3.3. Ghost Overlays During Rapid Mode Switch

- **Scenario**: Pending overlays don't appear when switching modes during a zoom animation.
- **Steps**:
  1.  Enter **Edit Mode** at a city with your pending overlays.
  2.  Zoom rapidly to make them visible.
  3.  **Immediately** switch to **View Mode** while map is still animating.
  4.  **Check**: NO pending overlay images appear on map after animation.
  5.  **Check**: NO pending overlay markers appear on map.
  6.  **Regression**: Switch back to Edit Mode.
  7.  **Check**: Pending overlays now correctly appear.

### 3.4. Rapid Mode Switching (Stress Test)

- **Scenario**: User frantically clicks mode buttons (View -> Edit -> Mod -> View).
- **Check**: Stop completely on **View Mode**.
- **Assert**:
  - No "Pending" markers are visible.
  - No "Edit" colored markers are visible.
  - (Prevents `handleViewportChange` processing stale mode data).

### 3.5. Mode Switch Preserves Rendering

- **Scenario**: Switching mode after viewport load re-renders correctly.
- **Steps**:
  1.  Load a city in **View Mode** at high zoom.
  2.  Switch to **Edit Mode**.
  3.  **Check**: `hasPendingChanges` / `suggestedCorners` are refreshed via batch update.
  4.  **Check**: Marker colors update immediately (yellow for pending changes).
  5.  Switch back to **View Mode**.
  6.  **Check**: Markers return to timeline colors.

### 3.6. Mode Switch With Bbox Loading

- **Scenario**: Switching between view, edit, and moderation modes correctly transitions between tile-driven and bbox-driven rendering.
- **Steps**:
  1. Start in **View Mode** at street level. Overlays are rendered by vectorTileSync (MVT idle sync).
  2. Switch to **Edit Mode**.
  3. Observe overlays reload from the bbox tRPC fetch. User's pending overlays also appear.
  4. Move an overlay. Switch to **View Mode**, overlay returns to database position.
  5. Switch back to **Edit Mode**, overlay returns to the cached (moved) position.
  6. Switch to **Moderation Mode**, all users' pending content appears.
- **Checks**:
  1. No flash of empty content during mode transitions (overlays not visible in new mode are hidden before fetch).
  2. Standalone project markers for local (unsaved) projects appear immediately after switching to Edit mode.
  3. The cluster source is restored to base (approved-only) data when returning to View mode.

### 3.7. Mode Switch Performance at Scale

- **Scenario**: Switching modes remains fast regardless of overlay count.
- **Steps**:
  1.  Navigate to city with **50+ overlays** at high zoom.
  2.  Switch from **View Mode** to **Moderation Mode**.
  3.  **Check**: Mode switch completes in under 200ms.
  4.  Switch back to **View Mode**.
  5.  **Check**: Switch remains fast (no degradation).
  6.  Repeat mode switch 5-10 times rapidly.
  7.  **Check**: Performance remains consistent.

## 4. Edit Mode

### 4.1. Position Memory & Persistence

- **Scenario**: User modifies an overlay but does not save immediately.
- **Steps**:
  1.  Enter **Edit Mode**. Select Overlay A.
  2.  Move Overlay A significantly (modifying corners).
  3.  **Toggle**: Switch to **View Mode** (Overlay A should snap back to its original database position).
  4.  **Toggle**: Switch back to **Edit Mode**.
  5.  **Check**: Overlay A should **snap to the modified position** from step 2 (from local cache).
  6.  **Exit**: Refresh page or "Cancel Editing". Re-enter Edit Mode.
  7.  **Check**: Overlay A should be at the database position (cache cleared).

### 4.2. Marker Coloring & Status

- **Scenario**: Identify overlay status via visual cues.
- **Checks**:
  1.  **View Mode**: Markers follow "Timeline" colors (e.g., Green=Completed, Blue=Planned).
  2.  **Edit Mode Entry**: Markers switch to "Status" colors.
      - **Approved/Unmodified**: Standard color.
      - **Modified (Unsaved)**: **Orange**.
      - **Pending/Rejected**: distinct status colors.
  3.  **Regression**: Ensure the color updates _immediately_ upon entering Edit Mode, not requiring a map interaction to refresh.

### 4.3. Edit Toolbar

- **Scenario**: Interacting with the Edit Toolbar.
- **Checks**:
  1.  Select an overlay. Verify the **Edit Toolbar** appears.
  2.  An opacity slider is present.
  3.  In edit mode, if the overlay is pending, a trash bin icon is present.
  4.  In edit mode, a pencil button is present.
  5.  In edit mode, a submit button is present and grayed out until a change is made.

### 4.4. Undo/Redo Works on First Edit Mode Entry

- **Scenario**: Keyboard shortcuts are registered via `overlayEditing.ts` (not `MapView.vue`), triggered on first mode switch.
- **Steps**:
  1.  Load the map without switching modes. Stay in **View Mode**.
  2.  Switch to **Edit Mode** for the first time.
  3.  Select an overlay and move a corner.
  4.  Press **Ctrl+Z**.
  5.  **Check**: The overlay corner returns to its previous position (undo worked).
  6.  Press **Ctrl+Y** (or **Ctrl+Shift+Z**).
  7.  **Check**: The corner moves back to the modified position (redo worked).
  8.  Switch to **View Mode** and back to **Edit Mode**.
  9.  Press **Ctrl+Z** again.
  10. **Check**: Undo still works (no duplicate event listeners, no missed registration).

### 4.5. Date Precision Changes Trigger Save State

- **Scenario**: Changing date precision fields marks project as modified.
- **Steps**:
  1.  Enter **Edit Mode**.
  2.  Select a project with dates (proposal/start/end).
  3.  Change **Proposal Date Precision** (e.g., from "Full" to "Year Only").
  4.  **Check**: "Save" button becomes enabled.
  5.  **Check**: Project is marked as having unsaved changes.
  6.  Open submission dialog.
  7.  **Check**: Precision change appears in summary (e.g., "Proposal Date Precision: Full → Year Only").
  8.  Submit changes.
  9.  **Check**: Backend receives and persists the new precision value.

### 4.6. All Date Precision Fields Detected

- **Scenario**: All three date precision fields are tracked for changes.
- **Steps**:
  1.  Enter **Edit Mode** and select a project.
  2.  Change **Start Date Precision** only.
  3.  **Check**: Change is detected and save button enabled.
  4.  Revert and change **End Date Precision** only.
  5.  **Check**: Change is detected and save button enabled.
  6.  Revert and change **Proposal Date Precision** only.
  7.  **Check**: Change is detected and save button enabled.

### 4.7. Caption Change Submits Correctly

- **Scenario**: Changing only the caption of an approved overlay opens a valid submission dialog with the caption diff.
- **Steps**:
  1.  Enter **Edit Mode** at high zoom. Select an **approved** overlay that has no existing unsaved changes.
  2.  Click the overlay to open its toolbar.
  3.  Change the **caption** field and save.
  4.  **Check**: Overlay marker turns **orange** (isModified = true).
  5.  Open the overlay toolbar again.
  6.  **Check**: A box above the toolbar shows the new overlay name.

### 4.8. Replacement Image Appears on Map After Upload

- **Scenario**: Uploading a replacement image via the toolbar replace button correctly places the new overlay on the map.
- **Steps**:
  1.  Enter **Edit Mode** at high zoom. Select an **approved** overlay.
  2.  Click the **Replace Image** toolbar button (image icon).
  3.  In the **Image Upload Dialog**, select an image file and click **Confirm**.
  4.  **Check**: A success toast appears.
  5.  **Check**: A **new overlay image** appears on the map at the project's location.
  6.  **Check**: The new overlay is automatically **selected** (toolbar visible).
  7.  **Check**: The original overlay is still visible behind it.
  8.  **Regression**: The new overlay's marker is visible at its center.

### 4.9. First Image on Standalone Project Appears

- **Scenario**: Uploading the very first image on a standalone project correctly displays it.
- **Steps**:
  1.  Enter **Edit Mode**. Navigate to a **standalone project** (no overlays yet).
  2.  Open the project detail panel and click the **Add Image** button.
  3.  Select an image file and confirm.
  4.  **Check**: The overlay image **appears on the map** immediately.
  5.  **Check**: The standalone project marker is **removed** once the overlay appears.

## 4.10 Overlay positionning and their markers

- **Scenario**: Pan/zoom loads overlays and edit-mode status markers at the shared display threshold.
- **Steps**:
  1.  Navigate to a known overlay position and zoom past **MIN_ZOOM_FOR_OVERLAYS** level.
  2.  **Check**: Overlay images and edit-mode status markers appear.
  3.  **Check**: Overlay marker colors correctly reflect status (e.g., yellow for `hasPendingChanges`).
  4.  Zoom back out below threshold.
  5.  **Check**: Images are hidden and existing status markers remain at their centroids.
  6.  Zoom in again.
  7.  **Check**: Images re-appear correctly (no blank map).

### 4.11 Change-Request Position Becomes the Edit-Mode Default

- **Scenario**: After submitting a position change request, the suggested position is the consistent edit-mode default (no post-submit undo history, no reload snap-back).
- **Steps**:
  1.  In **Edit Mode**, move an approved overlay and submit a position change request.
  2.  **Check**: The overlay stays exactly where it was left (no snap-back); its marker is yellow.
  3.  Press **Ctrl+Z**.
  4.  **Check**: Nothing happens (undo history did not survive submission).
  5.  Switch to **View Mode**, then back to **Edit Mode**.
  6.  **Check**: The overlay shows its suggested (proposed) position, not the approved one.
  7.  Reload the page and re-enter **Edit Mode**.
  8.  **Check**: The overlay still shows its suggested position.
  9.  **Check**: The "view approved" / "view suggested" toggle still moves the image between the two positions.
  10. Move the overlay again, then revert the staged corners change.
  11. **Check**: It lands on the suggested position (not the approved one).
  12. Switch to **Moderation Mode** (as an authorized moderator).
  13. **Check**: The overlay defaults to its approved position; explicit preview buttons still work.

### 4.12 Change-Request Caption Becomes the Edit-Mode Default

- **Scenario**: Caption is symmetric with position (§4.11): after submitting a caption change request, the proposed caption is the consistent edit-mode default, with no store backing the delta.
- **Steps**:
  1.  In **Edit Mode**, change an approved overlay's caption and submit a caption change request.
  2.  **Check**: The caption stays exactly as typed (no snap-back to the approved caption).
  3.  Reload the page and re-enter **Edit Mode**.
  4.  **Check**: The overlay's editor shows the proposed caption, not the approved one.
  5.  Change the caption again, then revert the staged caption change (revert button).
  6.  **Check**: It lands on the proposed caption (not the approved one).
  7.  Type the caption back to its edit-mode default by hand.
  8.  **Check**: The overlay is no longer flagged unsaved (the derived delta drops with no manual clear).
  9.  Delete the overlay from the store (e.g. navigate away so it is wiped from the viewport) with an unsaved caption edit.
  10. **Check**: The unsaved caption edit dies with the overlay; no stale caption is submitted afterward.
  11. Switch to **Moderation Mode** (as an authorized moderator).
  12. **Check**: Moderation caption display is unaffected (uses the explicit preview flow, not the edit-mode default).

### 4.13 Late-Arriving Change-Request State (Tile-to-Bbox Hydration)

- **Scenario**: An approved overlay with an open position change request first loads via view-mode tiles (which carry no CR state), then edit mode hydrates it via the bbox fetch. Image, marker color and marker position must converge without any user interaction.
- **Steps**:
  1.  As the CR author, load the overlay's area in **View Mode** at high zoom (overlay renders from tiles at its approved position).
  2.  Switch to **Edit Mode** and wait for the bbox fetch (no pan/zoom).
  3.  **Check**: The overlay image moves to the **suggested** position and the marker turns **yellow** at that position, without needing to unzoom or pan.
  4.  Click the overlay image.
  5.  **Check**: The image does **NOT** move on click; edit handles appear exactly on the image where it sits.
  6.  Slightly unzoom and re-zoom (triggers refetches).
  7.  **Check**: No position jumps, no marker color flicker.
  8.  Move the overlay, then press **Ctrl+Z**.
  9.  **Check**: Undo returns to the **suggested** position (the seed), not the approved one.
  10. Withdraw the change request from My Contributions.
  11. **Check**: The image snaps back to the **approved** position, marker turns green, and an untouched caption reverts to the approved caption.
  12. **Regression**: Repeat step 10 with a staged (unsubmitted) move on the overlay; the staged position must survive the withdrawal (only unedited overlays snap back).

### 4.14 Change-Request Overlay: Clicking and Viewport Membership at the Suggested Position

- **Scenario**: An approved overlay with an open position change request renders at the **suggested** position in edit mode, which can sit away from its approved footprint (the clickable tile footprint and the bbox spatial filter both key on the approved geometry).
- **Steps**:
  1.  As the CR author, submit a position change request that moves an overlay noticeably (ideally more than a viewport-width away).
  2.  In **Edit Mode**, look at the **suggested** position's area (approved position off-screen).
  3.  **Check**: The overlay image and yellow marker render there (the bbox fetch returns the user's CR overlays regardless of bbox).
  4.  Click the image at the suggested position.
  5.  **Check**: The overlay gets selected and edit handles appear (point-in-polygon fallthrough; the vector-tile footprint is at the approved position).
  6.  Pan to the **approved** position's area (suggested position off-screen).
  7.  **Check**: No image or ghost marker sits at the approved position, and no create/destroy churn in the console (viewport membership follows the suggested position, not the baseline).
  8.  Zoom in tightly onto one **edge** of the overlay so its approved centroid is far off-screen, then re-enter edit mode.
  9.  **Check**: The image shows at the suggested position (no stale approved-position render waiting for a later bbox fetch).
  10. Toggle **view approved position** on the selected overlay.
  11. **Check**: The image shows at the approved position and clicking it there still selects it.

## 5. Markers & Standalone Projects

### 5.1. New Marker Survives Zoom Operations

- **Scenario**: Newly created standalone project marker doesn't crash on zoom.
- **Steps**:
  1.  Enter **Edit Mode**.
  2.  Create a new standalone project (no overlays).
  3.  Submit the project form (marker appears on map).
  4.  Immediately zoom in and out using the scroll wheel.
  5.  **Check**: No browser crash or console errors during zoom animation.
  6.  **Check**: Marker remains visible and animates smoothly.
  7.  **Regression**: Repeat zoom operations multiple times rapidly.
  8.  **Check**: Markers remain stable, no console errors.

### 5.2. Markers Persist at Low Zoom in Edit Mode

- **Scenario**: Standalone project markers persist when zooming below the overlay display threshold in edit mode.
- **Steps**:
  1.  Enter **Edit Mode**.
  2.  Create or view standalone project markers.
  3.  Zoom out below the overlay display threshold.
  4.  **Check**: Markers remain visible (not cleared).
  5.  Pan around at low zoom.
  6.  **Check**: Markers stay on map.
  7.  Zoom back in.
  8.  **Check**: Markers are still visible and correctly positioned.
  9.  Switch to **View Mode**.
  10. **Check**: Only approved markers remain visible (pending ones hidden).

### 5.3. Marker Animation During Flight

- **Scenario**: Markers animate correctly during map.flyTo operations.
- **Steps**:
  1.  Navigate to an overlay using "Latest Contributions" panel.
  2.  Watch the map flight animation.
  3.  **Check**: Markers animate smoothly during flight (no null reference errors).
  4.  **Check**: Markers are correctly positioned at flight destination.

### 5.4. Overlay Markers Cleared When Switching to Overlay-Less City

- **Scenario**: Navigating from a city with overlays to one with only standalone projects clears old overlay markers.
- **Steps**:
  1.  Navigate to **City A** (has overlays) at zoom 14+. Overlay images and markers appear.
  2.  Click **City B** marker (a nearby city with only standalone projects, no overlays).
  3.  **Check**: City A's overlay images are removed from the map.
  4.  **Check**: City A's overlay markers (dots/icons) are removed from the map.
  5.  **Check**: City B's standalone project markers appear.
  6.  **Regression**: Click City A again.
  7.  **Check**: City A's overlays and markers re-render correctly (no duplicates).
  8.  **Regression**: Switch to a city with **no** standalone projects, verify old markers are still removed instantly.

### 5.5. Cross-City Zoom Without Click (Viewport Loading)

- **Scenario**: Zooming from one city to a nearby one via viewport loading preserves marker consistency.
- **Steps**:
  1.  Click **City A** marker → overlays load at zoom 14+.
  2.  Unzoom to zoom level 10 or below.
  3.  Zoom back into **City B** (nearby, without clicking its marker).
  4.  At **zoom 13**: **Check** interactive overlay markers appear for City B (hovering highlights them).
  5.  At **zoom 14**: **Check** overlay images AND their interactive markers are both visible.
  6.  **Regression**: Unzoom to 12, zoom back to 14. Verify markers still appear.

## 6. Panels & Navigation

### 6.1. KeepAlive Preserves Scroll Position

- **Scenario**: Panel scroll position is preserved when switching between panels.
- **Steps**:
  1.  Open **"Latest Contributions"** panel.
  2.  Scroll down halfway through the list.
  3.  Switch to **"Current Location"** panel.
  4.  Switch back to **"Latest Contributions"** panel.
  5.  **Check**: Scroll position is preserved (still at halfway point).

### 6.2. Panel State Across Mode Switches

- **Scenario**: Accordion state is store-backed and survives mode switches; the contribute and
  moderation panels remount and reload their data on every visit.
- **Steps**:
  1.  Open a project accordion in **View Mode**.
  2.  Switch to **Edit Mode**.
  3.  **Check**: Previously opened accordion remains open.
  4.  Sign out, sign in as another account, and open the **Contribute** panel.
  5.  **Check**: Contributions belong to the new account, with no leftovers from the previous one.

### 6.3. Overlay Click Expands and Scrolls Panel

- **Scenario**: Clicking an overlay on the map navigates the panel to the overlay details.
- **Steps**:
  1.  Click an **overlay** on the map.
  2.  **Check**: Panel finds containing city and expands it.
  3.  **Check**: Panel finds containing project and expands it.
  4.  **Check**: Panel scrolls to show overlay details.
  5.  **Regression**: Click different overlay in different city.
  6.  **Check**: Panel navigates to new city/project/overlay correctly.

### 6.4. Detail Entry Paths Share Selection Effects

- **Scenario**: Every user-facing way to open a project or overlay runs the same detail workflow.
- **Steps**:
  1. Open a project from a vector feature, then from the contributions panel.
  2. Open an overlay from its marker, then from panel navigation.
  3. In moderation mode, open a project and an overlay from their previews.
  4. Close the detail, submit a change, then sign out while detail is open.
- **Checks**:
  1. Project detail always shows the supplied project and switches moderation country when needed.
  2. Overlay detail always raises the selected raster and loads its parent project when absent.
  3. Closing detail and submitting remove pinned detail without clearing unrelated hover state.
  4. Signing out clears both pinned detail and hover with the other user-scoped state.

### 6.5. Camera Flies to Different City

- **Scenario**: Clicking a contribution in a different city triggers a camera flight.
- **Steps**:
  1.  Navigate to **Paris** and zoom in to street level (zoom 18+).
  2.  Open **"Latest Contributions"** panel.
  3.  Click contribution from **Lyon** (different city).
  4.  **Check**: Camera flies to Lyon (map animates/moves).
  5.  **Check**: Target overlay is selected and visible.
  6.  **Check**: Map is zoomed to appropriate level for overlay.

### 6.6. Same-City Navigation Preserves Zoom

- **Scenario**: Navigating within same city respects current zoom level.
- **Steps**:
  1.  Load a city and zoom to street level.
  2.  Click another overlay in the **same city** via panel.
  3.  **Check**: Camera pans to overlay without forcing zoom change.
  4.  **Check**: Current zoom level is preserved if already at appropriate level.
  5.  **Regression**: Click multiple overlays in same city.
  6.  **Check**: Navigation remains smooth without unnecessary zoom resets.

### 6.7. Cross-Country Navigation

- **Scenario**: Navigate between countries via side menu.
- **Steps**:
  1.  View project in **France** at high zoom.
  2.  Open side menu and navigate to contribution in **USA**.
  3.  **Check**: Camera flies across countries to USA.
  4.  **Check**: No freezing or stuttering during flight.
  5.  **Check**: Correct overlay is selected upon arrival.

### 6.8. Contribution Feed Pagination and Filters

- **Scenario**: Mixed contribution streams remain complete and stable across page boundaries.
- **Steps**:
  1.  Open **Explore** with both community and OSM sources selected.
  2.  Scroll through enough pages to pass the oldest community contribution.
  3.  **Check**: Contributions remain newest-first without duplicates or missing rows.
  4.  **Check**: Unnamed imported projects appear when the name filter is not active.
  5.  Enable **Only with images** and repeat the scroll.
  6.  **Check**: Every standalone project has a render and every overlay has its map image.
  7.  **Check**: The project count updates when source or filters change and stays unchanged while loading more pages.

## 7. Filtering

### 7.1. FilterControl Works at All Zoom Levels

- **Scenario**: Completion status filters apply to project points at low zoom and full overlay images at high zoom.
- **Steps**:
  1.  Navigate to a city with multiple overlays in **View Mode**.
  2.  Ensure map shows a mix of proposed, planned, in-progress, and completed overlays.
  3.  Zoom below **MIN_ZOOM_FOR_OVERLAYS**.
  4.  Click **Filter button** (pi-filter icon).
  5.  Uncheck **"Proposed"** (yellow) status.
  6.  **Check**: Yellow project points disappear from map.
  7.  **Check**: Other status project points remain visible.
  8.  Zoom to **overlay level** (zoom >= MIN_ZOOM_FOR_OVERLAYS).
  9.  **Check**: Full overlay images with "proposed" status are hidden.
  10. **Check**: Only overlays matching checked statuses are visible.
  11. **Regression**: Toggle filters on and off multiple times.
  12. **Check**: Overlays correctly appear/disappear at both zoom levels.

### 7.2. Filter State Persists Across Zoom

- **Scenario**: Filter selections persist when zooming in and out.
- **Steps**:
  1.  Set filters to hide **"In Progress"** and **"Completed"** statuses.
  2.  Verify filtered project points at low zoom.
  3.  Zoom in to overlay level.
  4.  **Check**: Filter state is preserved (same overlays hidden).
  5.  Zoom out and back in.
  6.  **Check**: Filters remain applied consistently.
  7.  Reset filters (check all statuses).
  8.  **Check**: All overlays/markers become visible again.

## 8. Tile Layers (Plan / Satellite)

The layer menu exposes only **Plan** and **Satellite**. Country-specific satellite layers (France, Switzerland, Quebec, ...) are applied automatically based on location, are hidden from the UI, and require authentication.

### 8.1. Smart Toggle Between Plan and Satellite

- **Scenario**: Single-click toggle switches between Plan (OSM) and the appropriate satellite layer.
- **Steps**:
  1.  Start with map on **Plan (OSM)** layer.
  2.  Click **Satellite Preview** button in bottom-left.
  3.  **Check**: Map switches to **Satellite** layer (ESRI or country-specific).
  4.  **Check**: Preview button now shows "Plan" preview image.
  5.  Click the preview button again.
  6.  **Check**: Map switches back to **Plan (OSM)**.
  7.  **Check**: Preview button shows "Satellite" preview image again.

### 8.2. Manual Toggle Applies Correct Country Layer Immediately

- **Scenario**: Manually switching to Satellite mode immediately applies the correct country layer.
- **Steps**:
  1.  Start in **Plan** mode.
  2.  Navigate to a location in **France** (e.g., Paris).
  3.  Click the **Satellite Preview** button.
  4.  **Check**: Map switches immediately to the **France** satellite layer.
  5.  **Check**: Map does NOT briefly show the ESRI layer before switching.
  6.  **Regression**: Navigate to a location without specific layer (e.g., Spain).
  7.  Click Satellite Preview.
  8.  **Check**: Map switches to the **ESRI** layer.

### 8.3. Toggle Cooldown (Leading Edge Debounce)

- **Scenario**: Instant switch on first click, subsequent rapid clicks ignored.
- **Steps**:
  1.  Start in **Plan** mode.
  2.  Click **Satellite Preview** button **ONCE**.
  3.  **Check**: The button image/label toggles **INSTANTLY**.
  4.  **Action**: Immediately click the button 5 more times (within 500ms).
  5.  **Check**: The map retrieves the Satellite layer and **STAYS** there.
  6.  **Check**: The 5 rapid clicks are ignored (no toggling back and forth).
  7.  **Action**: Wait 1 second, then click again.
  8.  **Check**: The map switches back to Plan immediately.

### 8.4. Layer Selection Menu (Hover)

- **Scenario**: Desktop users can access the layer menu via hover; it only offers Plan and Satellite.
- **Steps**:
  1.  On desktop, hover over **Satellite Preview** button.
  2.  **Check**: Menu shows exactly **2 options**: "Plan" and "Satellite" (no country-specific options, even for authenticated users).
  3.  Click between Plan and Satellite.
  4.  **Check**: Toggle works correctly.
  5.  **Check**: Preview button does NOT scale/grow during hover.
  6.  Move mouse away.
  7.  **Check**: Menu disappears.

### 8.5. Mobile Drawer Integration

- **Scenario**: Satellite preview button follows mobile drawer state.
- **Steps**:
  1.  Open app on mobile viewport or resize to mobile width.
  2.  **Check**: Satellite Preview button is visible above map.
  3.  Open mobile drawer (swipe up or click).
  4.  **Check**: Satellite Preview button moves up with drawer.
  5.  **Check**: NO duplicate buttons appear.
  6.  Drag drawer to different positions.
  7.  **Check**: Button position updates to stay above drawer.

### 8.6. Auto-Switch When Panning to a Supported Country

- **Scenario**: Map automatically switches to a country satellite layer when panning into its territory.
- **Steps**:
  1. Start in **Satellite** mode (global ESRI layer), authenticated.
  2. Pan the map to **Paris, France** and wait for `moveend`.
  3. **Check**: Tile layer automatically switches to the **France** high-res layer, tiles load and are visible.
  4. **Check**: UI still shows "Satellite" (not "France", country layers are hidden from UI).
  5. Pan the map to **Zurich, Switzerland** and wait for `moveend`.
  6. **Check**: Tile layer automatically switches to the **Switzerland** layer.
  7. **Regression**: Zoom in and out.
  8. **Check**: Layer remains Switzerland (doesn't switch back).

### 8.7. Fallback to ESRI Outside Supported Countries

- **Scenario**: Map falls back to global ESRI when viewing areas without country-specific layers.
- **Steps**:
  1. Start in France in Satellite mode (France layer active).
  2. Pan to **London, UK** (no UK-specific layer) and wait for `moveend`.
  3. **Check**: Tile layer automatically switches back to **ESRI** (global) and tiles load correctly.
  4. Pan to **New York, USA**.
  5. **Check**: Layer remains on ESRI.

### 8.8. No Auto-Switch in Plan Mode

- **Scenario**: Auto-switching only happens in Satellite mode, not Plan mode.
- **Steps**:
  1. Set map to **Plan (OSM)** mode.
  2. Pan to France, Switzerland, and other countries.
  3. **Check**: Layer remains on Plan (OSM) throughout, no automatic switching occurs.
  4. Switch to Satellite mode.
  5. **Check**: Auto-switching resumes based on current location.

### 8.9. Authentication Required for Country Layers

- **Scenario**: Unauthenticated users stay on the ESRI layer even when in France/Switzerland.
- **Steps**:
  1. Log out or open in incognito window (unauthenticated).
  2. Switch to Satellite mode.
  3. Pan to **Geneva, Switzerland**.
  4. **Check**: Layer remains on global **ESRI** (doesn't switch to Switzerland).
  5. Pan to **Nice, France**.
  6. **Check**: Layer remains on global **ESRI**.
  7. Log in with authenticated account.
  8. **Check**: Layer automatically switches to **France**.

### 8.10. Cross-Border Navigation

- **Scenario**: Seamless switching when crossing borders between supported countries.
- **Steps**:
  1. Login and enable Satellite mode.
  2. Navigate to **Strasbourg, France** (near German border).
  3. **Check**: France layer is active.
  4. Pan slightly east across border into **Germany**.
  5. **Check**: Layer switches to **ESRI** (no Germany layer).
  6. Pan back into France.
  7. **Check**: Layer switches back to **France**.
  8. Pan to **Geneva** (France/Switzerland border).
  9. Pan across border into Switzerland.
  10. **Check**: Layer switches to **Switzerland**.

### 8.11. Layer Stability on Project Submit

- **Scenario**: Submitting a project does not disturb the active tile layer.
- **Steps**:
  1.  In Satellite mode in **France** (France layer auto-active), create and submit a new project.
  2.  **Check**: Tile layer remains **France** (does NOT flip to generic Satellite or Plan).
  3.  In Satellite mode in a country without a specific layer (e.g., USA), create and submit a project.
  4.  **Check**: Layer remains generic **Satellite** (ESRI).
  5.  Navigate back to France while still in Edit mode and submit another project.
  6.  **Check**: The France layer is active (auto-switch behavior still applies).

### 8.12. No Stale Country Tile Requests After Plan→Satellite Round-Trip

- **Scenario**: Re-enabling satellite over Quebec after visiting France does not briefly request France tiles.
- **Steps**:
  1.  Navigate to **France** and enable **Satellite** mode → France tile layer (`data.geopf.fr`) loads.
  2.  Switch back to **Plan** (OSM) mode.
  3.  Pan to **Quebec, Canada**.
  4.  Open browser DevTools → Network tab, filter by `geopf.fr`.
  5.  Re-enable **Satellite** mode.
  6.  **Check**: No requests to `data.geopf.fr` appear in the Network tab.
  7.  **Check**: Only Quebec tile requests (`mern.gouv.qc.ca`) are made.
  8.  **Regression**: Verify no console errors about failed tile fetches from wrong tile servers.

### 8.13. Low MaxNativeZoom Regions (Esri)

- **Scenario**: Map correctly handles regions where Esri maxNativeZoom < 18.
- **Steps**:
  1.  Navigate to **Sucre, Bolivia** (metadata maxNativeZoom = 17).
  2.  Switch to **Satellite** tile layer.
  3.  Zoom to level 17.
  4.  **Check**: Satellite tiles load correctly.
  5.  Zoom to level 18+.
  6.  **Check**: Level 17 tiles are scaled up (NO gray tiles).
  7.  **Regression**: Check browser console for tile 404 errors.
  8.  **Check**: No 404 errors for zoom level 18 tiles.

### 8.14. Dynamic MaxNativeZoom Updates

- **Scenario**: Map redraw is triggered when moving to a region with lower maxNativeZoom.
- **Steps**:
  1.  Start at a region with maxNativeZoom = 18 at zoom level 18.
  2.  Navigate to **Dakar, Senegal** (metadata maxNativeZoom = 17).
  3.  **Check**: Map automatically redraws tiles.
  4.  **Check**: Tiles use zoom level 17 data scaled up.
  5.  **Check**: No gray/missing tiles appear.
  6.  Pan around the area.
  7.  **Check**: All tiles continue to load correctly at scaled resolution.

## 9. Moderation & Admin

### 9.1. Contextual Filtering

- **Scenario**: Admin reviewing content in a specific city.
- **Steps**:
  1.  Enter **Moderation Mode**.
  2.  Zoom to a viewport with pending items.
  3.  **Check 1**: The **Moderation Side Panel** should filter to show _only_ items for that city.
  4.  **Check 2 (Regression)**: The map camera **MUST NOT** jump to the Country center. It should stay focused on the city or bounds.
  5.  **Zoom Behavior**: Zoom in. Verify pending/unapproved overlays are visible on the map (rendered with "Pending" styling).

### 9.2. Two-Phase Image Loading

- **Scenario**: Approving an image.
- **Checks**:
  1.  **Pending State**: Verify image source is a local/temp URL (thumbnail).
  2.  **Action**: Click "Approve".
  3.  **Post-Approval**: Verify image source updates to the R2/Production URL. Verify the overlay remains visible and doesn't disappear during the transition.

### 9.3. Suggested / Approved Position Buttons

- **Scenario**: Moderator toggles an overlay between its suggested and approved positions.
- **Steps**:
  1.  Enter **Moderation Mode**. Select an overlay that has a pending position change.
  2.  Click **"View Suggested Position"**.
  3.  **Check**: Overlay moves to the suggested position on map, marker shows the suggested state (yellow).
  4.  Click **"View Approved Position"**.
  5.  **Check**: Overlay moves back to the approved position on map.
  6.  **Check**: Overlay marker updates to show the approved location.
  7.  **Check**: Overlay marker turns from yellow to green.
  8.  **Regression**: Test with overlays loaded via side menu (original working case).
  9.  **Regression**: As the request author, enter Edit Mode first so the suggested position is in
      the overlay history, then enter Moderation Mode. The approved preview must still move both
      image and marker to the approved position.

### 9.4. Change Request Lookups

- **Scenario**: Change requests are correctly and instantly associated in the moderation panel.
- **Steps**:
  1.  Load **Moderation Mode** with multiple change requests.
  2.  Expand project accordions that have change requests.
  3.  **Check**: Change request badges appear instantly (no per-item lag as the list grows).
  4.  **Regression**: Verify correct change requests are associated with each project/overlay.

### 9.5. Approval Stability (No Bouncy Scrolling)

- **Scenario**: Approving items doesn't cause unwanted panel scrolling.
- **Steps**:
  1.  Enter **Moderation Mode**.
  2.  Open a city with pending items.
  3.  Scroll panel to middle of list.
  4.  Approve an overlay or project.
  5.  **Check**: Panel does **NOT** jump back to city header.
  6.  **Check**: Panel remains at approximately same scroll position.
  7.  **Check**: Only the approved item UI updates (removed from pending list).
  8.  **Regression**: Approve multiple items in sequence.
  9.  **Check**: No scrolling occurs between approvals.

### 9.6. Admin: Manual Image Pruning

- **Location**: `/admin/reports` page, top-right of the page header. The entire `/admin/*` route requires admin role (enforced by the router guard), so no additional visibility check is needed.

#### 9.6.1. Successful Prune

- **Scenario**: Admin triggers a prune when scheduled deletions are due.
- **Steps**:
  1. Log in as admin. Navigate to `/admin/reports`.
  2. Click **"Prune Images"**. **Check**: Button shows a loading spinner while the request is in flight.
  3. **Check**: A success toast appears with the deleted and failed counts (e.g. `2 deleted, 0 failed`).
  4. **Check**: Button returns to its normal (non-loading) state after completion.

#### 9.6.2. Prune with No Pending Deletions

- **Scenario**: Admin triggers a prune when nothing is scheduled yet.
- **Steps**:
  1. Navigate to `/admin/reports` and click **"Prune Images"**.
  2. **Check**: Success toast appears with `0 deleted, 0 failed`.

#### 9.6.3. Toast Availability on Admin Pages (Regression)

- **Scenario**: Toasts must work on all pages, not just the map home page.
- **Checks**:
  1. Perform any action on `/admin/reports` that triggers a toast (e.g. clear reports, ban user, prune images).
  2. **Check**: Toast notification appears correctly.
  3. Navigate to `/admin/user/:userId` and perform a deletion.
  4. **Check**: Toast notification appears correctly.

## 10. Auth & Account

### 10.1. Successful Verification Auto-Login

- **Scenario**: User clicks verification link and is automatically logged in.
- **Steps**:
  1.  Register a new account (get verification link from console in dev mode).
  2.  Open verification link in new incognito window (no existing session).
  3.  **Check**: "Email Verified!" success message appears.
  4.  **Check**: "Signing you in..." message appears with spinner.
  5.  **Check**: Automatically redirected to home page after ~1.5 seconds.
  6.  **Check**: User menu/avatar shows user is logged in.
  7.  **Check**: Can access authenticated features (e.g., add project, view contributions).

### 10.2. Session Creation on Verification

- **Scenario**: Backend creates session cookie during email verification.
- **Steps**:
  1.  Complete steps from 10.1.
  2.  Check browser DevTools Application → Cookies.
  3.  **Check**: Session cookie is present after verification.
  4.  Refresh the page.
  5.  **Check**: User remains logged in (session persists).
  6.  **Check**: Session has 30-day expiration.

### 10.3. Already-Used Verification Token

- **Scenario**: Verification token can only be used once.
- **Steps**:
  1.  Use a verification link to verify email and auto-login.
  2.  Log out.
  3.  Try to use the same verification link again.
  4.  **Check**: "Invalid verification token" error appears.
  5.  **Check**: User is NOT logged in.
  6.  **Check**: "Back to App" button appears (not auto-redirect).

### 10.4. Registration Modal Flow

- **Scenario**: Modal stays open after registration with verification reminder.
- **Steps**:
  1.  Open auth modal and register new account.
  2.  **Check**: Modal remains open (doesn't close).
  3.  **Check**: Blue info box appears with "Verify Your Email" title.
  4.  **Check**: Message includes reminder to check spam folder.
  5.  **Check**: Toast notification also appears with success message.
  6.  Close modal manually.
  7.  **Regression**: Switch to login mode and verify form is reset correctly.

### 10.5. Google Auth Email Conflict Handling

- **Scenario**: Google OAuth fails gracefully when the new email address is already taken by another user.
- **Prerequisite**:
  1. User A exists with `email="existing@example.com"`.
  2. User B exists with `googleId="123"` and `email="old@example.com"`.
  3. Google returns `googleId="123"` but `email="existing@example.com"` (User B changed email to one that conflicts with User A).
- **Steps**:
  1. Trigger Google Login flow for User B with the conflicting email.
  2. **Check**: Backend returns 409 Conflict (or appropriate error code).
  3. **Check**: Error message code is `auth.error.emailTaken` (or `account_conflict`).
  4. **Check**: Response **DOES NOT** contain raw SQL error text (e.g., `duplicate key value violates unique constraint`).
  5. **Check**: User is shown a clear error message in the UI.
