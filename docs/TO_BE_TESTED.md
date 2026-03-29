# Frontend Testing Specification (Playwright)

This document outlines the granular functional test scenarios required to ensure application stability. It focuses on reproducing complex user behaviors and preventing regression of specific historical bugs.

## 1. Map Visualization & Entity Behavior

### 1.2b. Vector Tile Line Styling by Tag (New)

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

### 1.2c. Project Point Color by First Tag (New)

- **Scenario**: Single project points use the same color palette as `projectTags`.
- **Steps**:
  1.  Load an area where individual project points are visible (non-image zoom range).
  2.  Confirm points with different first tags (e.g. `tram`, `rail`, `bike`).
  3.  Find a zoom/area where a cluster contains a single project (`point_count = 1`).
- **Checks**:
  1.  Unclustered project points use the color mapped from `front/src/config/projectTags.ts` for `first_tag`.
  2.  A cluster circle with `point_count = 1` uses that same project color.
  3.  Unknown or missing first tag falls back to the default blue.

### 1.2d. Vector Hover and Click in Leaflet+MapLibre Hybrid Mode (New)

- **Scenario**: Vector features remain interactive when MapLibre is embedded through Leaflet (`maplibre-gl-leaflet`).
- **Steps**:
  1.  Open the map in View mode where vector layers are available.
  2.  Zoom to level 9+ where `project-shapes` lines are visible.
  3.  Zoom to level 14+ where `overlay-footprints` lines are visible.
  4.  Move the mouse slowly across vector lines and then over empty map areas.
  5.  Click a project shape line, then click an overlay footprint line.
- **Checks**:
  1.  On vector hover, cursor changes to pointer and a white highlight outline appears only on the hovered feature.
  2.  Leaving vector features clears the highlight and resets cursor.
  3.  Clicking a `project-shapes` feature opens the project popup for that feature id.
  4.  Clicking an `overlay-footprints` feature opens the popup for its `project_id`.
  5.  Clicking on a cluster still zooms/expands the cluster (cluster interaction is not regressed).
  6.  In areas where both relation and way features overlap, hover/click resolves to the relation feature when relation metadata is present (`relation_id` or `osm_type=relation`).

### 1.3. Standalone vs. Overlay Projects

- **Scenario**: Viewing different project types.
- **Checks**:
  1.  **Standalone Project**: Verify rendering of a project marker that has coordinates but `overlays.length === 0`.
  2.  **Transition**: Add an image to a Standalone Project. Verify it dynamically converts to an Overlay Project (marker appearance changes or overlay appears) without page reload.
  3.  **Error Check**: Validate that adding the _first_ image does not throw `TypeError: Cannot read properties of undefined (reading 'length')`.

## 2. The Edit Mode Workflow (Complex State)

### 2.1. Position Memory & Persistence

- **Scenario**: User modifies an overlay but does not save immediately.
- **Steps**:
  1.  Enter **Edit Mode**. Select Overlay A.
  2.  Move Overlay A significantly (modifying corners).
  3.  **Toggle**: Switch to **View Mode** (Overlay A should snap back to its original database position).
  4.  **Toggle**: Switch back to **Edit Mode**.
  5.  **Check**: Overlay A should **snap to the modified position** from step 2 (from local cache).
  6.  **Exit**: Refresh page or "Cancel Editing". Re-enter Edit Mode.
  7.  **Check**: Overlay A should be at the database position (Cache cleared).

### 2.2. Marker Coloring & Status

- **Scenario**: Identify overlay status via visual cues.
- **Checks**:
  1.  **View Mode**: Markers follow "Timeline" colors (e.g., Green=Completed, Blue=Planned).
  2.  **Edit Mode Entry**: Markers switch to "Status" colors.
      - **Approved/Unmodified**: Standard color.
      - **Modified (Unsaved)**: **Orange**.
      - **Pending/Rejected**: distinct status colors.
  3.  **Regression**: Ensure the color updates _immediately_ upon entering Edit Mode, not requiring a map interaction to refresh.

### 2.3. Tooling & Interaction

- **Scenario**: Interacting with the Edit Toolbar.
- **Checks**:
  1.  Select an overlay. Verify the **Edit Toolbar** appears (it was previously missing).
  2.  Test "Distort", "Move", "Rotate" toggles.
  3.  **Suggested Position**: Make a change -> Click "View Suggested Position". Verify a "Ghost Overlay" or preview visual appears at the new coordinates.

### 2.4. Popup Persistence During State Updates

- **Scenario**: Info popup remains accessible/open when overlay state updates.
- **Steps**:
  1. Select an overlay in Edit mode.
  2. Open the info popup (click ellipsis/info button).
  3. Trigger a state update (e.g., switch to View mode and back, or modify overlay).
  4. **Check**: Info popup reopens or button is still clickable.
  5. **Regression**: Verify no "Element not found" errors in console (related to `querySelector` fix).

## 3. Moderation & Admin Workflows

### 3.1. Contextual Filtering

- **Scenario**: Admin reviewing content in a specific city.
- **Steps**:
  1.  Enter **Moderation Mode**.
  2.  zoom somewhere that has pending items
  3.  **Check 1**: The **Moderation Side Panel** should filter to show _only_ items for that city.
  4.  **Check 2 (Regression)**: The map camera **MUST NOT** jump to the Country center. It should stay focused on the city or bounds.
  5.  **Zoom Behavior**: Zoom in. Verify pending/unapproved overlays are visible on the map (rendered with "Pending" styling).

### 3.2. Two-Phase Image Loading

- **Scenario**: Approving an image.
- **Checks**:
  1.  **Pending State**: Verify image source is a local/temp URL (thumbnail).
  2.  **Action**: Click "Approve".
  3.  **Post-Approval**: Verify image source updates to the R2/Production URL. Verify the overlay remains visible and doesn't disappear during the transition.

## 4. Navigation & Deep Linking

### 4.2. Current Location & Zoom Oscillation

- **Scenario**: User gets lost and clicks "My Location".
- **Steps**:
  1.  Zoom out to world view.
  2.  Click "My Location" (simulated geolocation).
  3.  **Check**: Map centers on user.
  4.  **Regression**: Verify local overlays render correctly. (Previous bug: Jumping from low zoom to high zoom caused renderer to miss the "add images" event).

## 5. Data Consistency & Race Conditions

### 5.1. Rapid Mode Switching (Stress Test)

- **Scenario**: User frantically clicks mode buttons (View -> Edit -> Mod -> View).
- **Check**: Stop completely on **View Mode**.
- **Assert**:
  - No "Pending" markers are visible.
  - No "Edit" colored markers are visible.
  - (Prevents `handleViewportChange` processing stale mode data).

### 5.2. Duplicate API & Caching

- **Scenario**: Panning around the same area.
- **Steps**:
  1.  Load City A (API Call triggered).
  2.  Pan away to City B.
  3.  Pan back to City A.
  4.  **Check**: No new API call for `getCityProjects` (Data should be in Pinia cache).

## 6. Authentication & System

- **Scenario**: Development/Preview environment access.
- **Check**: Verify `Set-Cookie` works across subdomains (e.g., backend on diff domain than frontend). Refresh page protects session.

## 8. Standalone Project Marker Persistence

### 8.1. Markers Persist After Zoom Operations

- **Scenario**: New standalone project marker should persist after zoom in Edit Mode.
- **Steps**:
  1.  Enter **Edit Mode**.
  2.  Add a new standalone project or view existing ones.
  3.  Zoom out beyond `VIEWPORT_LOAD_THRESHOLD`.
  4.  **Check**: Standalone markers remain visible (not removed).
  5.  Zoom back in.
  6.  **Check**: Standalone markers are still visible and correctly positioned.

## 9. Map Zoom Animation Stability

### 9.1. Markers Remain Stable During Zoom

- **Scenario**: Markers remain properly attached to the map during rapid zoom operations.
- **Steps**:
  1.  Add a new project in Edit Mode.
  2.  Immediately zoom in or out using scroll wheel.
  3.  **Check**: No crash occurs during zoom animation.
  4.  **Regression**: Repeat zoom operations multiple times rapidly.
  5.  **Check**: Markers remain stable, no console errors.

### 9.2. Marker Animation During Flight

- **Scenario**: Markers animate correctly during map.flyTo operations.
- **Steps**:
  1.  Navigate to an overlay using "Latest Contributions" panel.
  2.  Watch the map flight animation.
  3.  **Check**: Markers animate smoothly during flight (no null reference errors).
  4.  **Check**: Markers are correctly positioned at flight destination.

## 10. Moderation Position Buttons

### 10.2. View Approved Position Works From City Load

- **Scenario**: View approved position after viewing suggested.
- **Steps**:
  1.  Follow steps from 10.1 to view suggested position.
  2.  Click **"View Approved Position"** button.
  3.  **Check**: Overlay moves to approved position on map.
  4.  **Check**: Overlay marker updates to show approved location
  5.  **Check**: Overlay marker turns from yellow to green.
  6.  **Regression**: Test with overlays loaded via side menu (original working case).

## 11. Overlay Visibility Mode Switching

### 11.1. Pending Overlays Hide in View Mode

- **Scenario**: Pending overlays are properly hidden when switching from Moderation to View mode.
- **Steps**:
  1.  Enter **Moderation Mode**.
  2.  zoom to load overlays.
  3.  Verify pending overlays are visible on map.
  4.  Switch to **View Mode**.
  5.  **Check**: All pending overlays are removed from map.
  6.  **Check**: Only approved overlays remain visible.

### 11.2. Pending Overlays Remain Hidden During Zoom

- **Scenario**: Pending overlays stay hidden during zoom operations in View Mode.
- **Steps**:
  1.  Load a city in **Moderation Mode**.
  2.  Switch to **View Mode**.
  3.  Zoom out and then zoom in.
  4.  **Check**: Pending overlays do NOT reappear.
  5.  **Regression**: Pan around the city area.
  6.  **Check**: Pending overlays remain hidden.

## 12. Panel State Preservation (Recent Fix - Jan 13)

### 12.1. KeepAlive Preserves Scroll Position

- **Scenario**: Panel scroll position is preserved when switching between panels.
- **Steps**:
  1.  Open **"Latest Contributions"** panel.
  2.  Scroll down halfway through the list.
  3.  Switch to **"Current Location"** panel.
  4.  Switch back to **"Latest Contributions"** panel.
  5.  **Check**: Scroll position is preserved (still at halfway point).

### 12.2. Panel State Preserved Across Mode Switches

- **Scenario**: Panel accordion states and computed data are preserved when changing modes.
- **Steps**:
  1.  Open a project accordion in **View Mode**.
  2.  Switch to **Edit Mode**.
  3.  **Check**: Previously opened accordion remains open.
  4.  **Check**: Computed data (change requests, etc.) doesn't re-initialize unnecessarily.

## 13. Off-Screen Content Cleanup

### 13.2. Nearby Cities Remain Loaded

- **Scenario**: Cities within padded viewport bounds remain loaded during minor pans.
- **Steps**:
  1.  Load a city's content.
  2.  Pan slightly (still within padded bounds).
  3.  **Check**: City content remains loaded (no unnecessary reload).
  4.  **Regression**: Verify no performance issues from repeated bounds checks.

## 14. Performance Optimizations

### 14.1. Change Request Map Lookups

- **Scenario**: Change requests are efficiently retrieved using optimized map lookups.
- **Steps**:
  1.  Load **Moderation Mode** with multiple change requests.
  2.  Expand project accordions that have change requests.
  3.  **Check**: Change request badges appear instantly (O(1) map lookup vs O(N) array find).
  4.  **Regression**: Verify correct change requests are associated with each project/overlay.

## 15. Map Navigation Performance (Recent Fix - Jan 12)

### 15.1. FlyTo Defers Overlay Rendering

- **Scenario**: Map flight animations remain smooth by deferring overlay rendering until completion.
- **Steps**:
  1.  Navigate to an overlay using "Latest Overlays" panel.
  2.  Watch the map flight closely.
  3.  **Check**: Flight animation is smooth (60fps or close).
  4.  **Check**: Overlay images only appear AFTER flight completes.
  5.  **Regression**: Verify overlays do eventually render after arrival.

## 16. Overlay Fetching Timing (Recent Fix - Jan 12)

### 16.1. Deferred Overlay Fetching During Flight

- **Scenario**: Overlay images are fetched only after map flight animation completes.
- **Steps**:
  1.  From a high zoom level, navigate to a different city at high zoom.
  2.  Monitor network tab during flight animation.
  3.  **Check**: Overlay image requests only start AFTER flight completes.
  4.  **Check**: Overlays within viewport are fetched after arrival.

### 16.2. Viewport Bounds Check

- **Scenario**: Only overlays within the viewport bounds are fetched and rendered.
- **Steps**:
  1.  Load a city at high zoom.
  2.  Position map so some overlays are outside viewport.
  3.  **Check**: Only overlays within viewport bounds are added to map.
  4.  **Check**: Off-screen overlays don't trigger image fetch.
  5.  Pan to reveal off-screen overlays.
  6.  **Check**: Newly visible overlays fetch and render correctly.

## 17. Overlay Image Loading Race Conditions (Recent Fix - Jan 12)

### 17.1. Reliable First Load Rendering

- **Scenario**: Overlays render correctly on first load even with cache disabled and slow network.
- **Steps**:
  1.  Clear browser cache.
  2.  Disable cache in DevTools.
  3.  Enable network throttling (Slow 3G).
  4.  Load a city with overlays at high zoom.
  5.  **Check**: All overlays render correctly on first load.
  6.  **Regression**: Repeat test 5-10 times to verify reliability.

### 17.2. Fast Cached Image Loading

- **Scenario**: Overlays render correctly when images load quickly from browser cache.
- **Steps**:
  1.  Load overlays to warm cache.
  2.  Refresh and load same city/overlays.
  3.  **Check**: Overlays render correctly with cached images.
  4.  **Check**: No console errors about image load handlers.

### 17.3. Graceful Cleanup During Load

- **Scenario**: Overlays are cleanly removed when map interactions occur before image loading completes.
- **Steps**:
  1.  Navigate to load overlays.
  2.  Immediately zoom out or switch mode before images finish loading.
  3.  **Check**: No crashes or console errors.
  4.  **Check**: Image load events are properly cleaned up.

## 18. Email Verification Auto-Login (Recent Feature - Feb 11)

### 18.1. Successful Verification Auto-Login

- **Scenario**: User clicks verification link and is automatically logged in.
- **Steps**:
  1.  Register a new account (get verification link from console in dev mode).
  2.  Open verification link in new incognito window (no existing session).
  3.  **Check**: "Email Verified!" success message appears.
  4.  **Check**: "Signing you in..." message appears with spinner.
  5.  **Check**: Automatically redirected to home page after ~1.5 seconds.
  6.  **Check**: User menu/avatar shows user is logged in.
  7.  **Check**: Can access authenticated features (e.g., add project, view contributions).

### 18.2. Session Creation on Verification

- **Scenario**: Backend creates session cookie during email verification.
- **Steps**:
  1.  Complete steps from 18.1.
  2.  Check browser DevTools Application → Cookies.
  3.  **Check**: Session cookie is present after verification.
  4.  Refresh the page.
  5.  **Check**: User remains logged in (session persists).
  6.  **Check**: Session has 30-day expiration.

### 18.3. Already-Used Verification Token

- **Scenario**: Verification token can only be used once.
- **Steps**:
  1.  Use a verification link to verify email and auto-login.
  2.  Log out.
  3.  Try to use the same verification link again.
  4.  **Check**: "Invalid verification token" error appears.
  5.  **Check**: User is NOT logged in.
  6.  **Check**: "Back to App" button appears (not auto-redirect).

### 18.4. Registration Modal Flow

- **Scenario**: Modal stays open after registration with verification reminder.
- **Steps**:
  1.  Open auth modal and register new account.
  2.  **Check**: Modal remains open (doesn't close).
  3.  **Check**: Blue info box appears with "Verify Your Email" title.
  4.  **Check**: Message includes reminder to check spam folder.
  5.  **Check**: Toast notification also appears with success message.
  6.  Close modal manually.
  7.  **Regression**: Switch to login mode and verify form is reset correctly.

## 19. Date Precision Change Detection (Recent Fix - Jan 19)

### 19.1. Date Precision Changes Trigger Save State

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

### 19.2. All Date Precision Fields Detected

- **Scenario**: All three date precision fields are tracked for changes.
- **Steps**:
  1.  Enter **Edit Mode** and select a project.
  2.  Change **Start Date Precision** only.
  3.  **Check**: Change is detected and save button enabled.
  4.  Revert and change **End Date Precision** only.
  5.  **Check**: Change is detected and save button enabled.
  6.  Revert and change **Proposal Date Precision** only.
  7.  **Check**: Change is detected and save button enabled.

## 20. Overlay Visibility Race Conditions (Recent Fix - Jan 18)

### 20.1. Ghost Overlays During Rapid Mode Switch

- **Scenario**: Pending overlays don't appear when switching modes during zoom animation.
- **Steps**:
  1.  Enter **Edit Mode** at a city with your pending overlays.
  2.  Ensure overlays are visible.
  3.  start Zooming at it fast to make it appear
  4.  **Immediately** switch to **View Mode** while map is still animating.
  5.  **Check**: NO pending overlay images appear on map after animation.
  6.  **Check**: NO pending overlay markers appear on map.
  7.  **Regression**: Switch back to Edit Mode.
  8.  **Check**: Pending overlays now correctly appear.

### 20.2. Marker Visibility Consistency with Images

- **Scenario**: Overlay markers follow same visibility rules as overlay images.
- **Steps**:
  1.  Load a city with pending overlays in **Moderation Mode**.
  2.  Verify both markers and images are visible.
  3.  Switch to **View Mode**.
  4.  **Check**: Pending markers are removed (not just images).
  5.  Zoom in and out.
  6.  **Check**: Pending markers remain hidden.
  7.  Switch to **Edit Mode**.
  8.  **Check**: Your pending markers reappear along with images.

## 21. Tile Layer Auto-Switch Prevention (Recent Fix - Jan 18)

### 21.1. Country-Specific Layer Persistence on Project Submit

- **Scenario**: Submitting project doesn't change tile layer if already on correct country layer.
- **Steps**:
  1.  Navigate to France.
  2.  Switch to **"France"** satellite layer via layer selector.
  3.  Create and submit a new project in France.
  4.  **Check**: Tile layer remains **"France"** (does NOT switch to generic "Satellite").
  5.  **Regression**: Navigate to another location in France.
  6.  **Check**: Layer is still "France".

### 21.2. Auto-Switch to Generic Satellite Layer

- **Scenario**: Layer correctly switches to generic satellite for countries without specific layers.
- **Steps**:
  1.  Set tile layer to **"OSM"** (plan view).
  2.  Navigate to a country without specific satellite layer (e.g., USA).
  3.  Create and submit a project.
  4.  **Check**: Layer automatically switches to **"Satellite"** (generic Esri layer).
  5.  Navigate to France while still in Edit mode.
  6.  Submit another project.
  7.  **Check**: Layer switches from "Satellite" to **"France"** layer.

## 22. Esri Max Zoom Handling (Recent Fix - Jan 17)

### 22.1. Low MaxNativeZoom Regions

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

### 22.2. Dynamic MaxNativeZoom Updates

- **Scenario**: Map redraw is triggered when moving to region with lower maxNativeZoom.
- **Steps**:
  1.  Start at a region with maxNativeZoom = 18 at zoom level 18.
  2.  Navigate to **Dakar, Senegal** (metadata maxNativeZoom = 17).
  3.  **Check**: Map automatically redraws tiles.
  4.  **Check**: Tiles use zoom level 17 data scaled up.
  5.  **Check**: No gray/missing tiles appear.
  6.  Pan around the area.
  7.  **Check**: All tiles continue to load correctly at scaled resolution.

### 22.3. Forcing Leaflet Internal Recalculation

- **Scenario**: Leaflet's internal tile zoom calculation updates when maxNativeZoom changes.
- **Steps**:
  1.  Navigate between regions with different maxNativeZoom values (18 → 17 → 18).
  2.  Stay at high zoom level (18+) during navigation.
  3.  **Check**: Tiles load correctly in each region.
  4.  **Check**: No stale tile zoom calculations cause gray tiles.
  5.  **Regression**: Verify map interactions (pan, zoom) remain smooth.
  6.  **Check**: No performance degradation from forced recalculations.

## 23. Satellite Preview Component (Recent Feature - Jan 16-17)

### 23.1. Smart Toggle Between Plan and Satellite

- **Scenario**: Single-click toggle switches between Plan (OSM) and appropriate satellite layer.
- **Steps**:
  1.  Start with map on **Plan (OSM)** layer.
  2.  Click **Satellite Preview** button in bottom-left.
  3.  **Check**: Map switches to **Satellite** layer (Esri or country-specific).
  4.  **Check**: Preview button now shows "Plan" preview image.
  5.  Click the preview button again.
  6.  **Check**: Map switches back to **Plan (OSM)**.
  7.  **Check**: Preview button shows "Satellite" preview image again.

### 23.2. Context-Aware Layer Selection

- **Scenario**: Preview button switches to country-specific satellite layer when available.
- **Steps**:
  1.  Start on **Plan** layer.
  2.  Navigate to **France**.
  3.  Click **Satellite Preview** button.
  4.  **Check**: Map switches to **"France"** layer (not generic Satellite).
  5.  Navigate to **USA** (no country-specific layer).
  6.  **Check**: Map switches to generic **"Satellite"** layer.
  7.  Navigate back to **France**.
  8.  **Check**: Map switches back to **"France"** layer.

### 23.3. Mobile Drawer Integration

- **Scenario**: Satellite preview button follows mobile drawer state.
- **Steps**:
  1.  Open app on mobile viewport or resize to mobile width.
  2.  **Check**: Satellite Preview button is visible above map.
  3.  Open mobile drawer (swipe up or click).
  4.  **Check**: Satellite Preview button moves up with drawer.
  5.  **Check**: NO duplicate buttons appear.
  6.  Drag drawer to different positions.
  7.  **Check**: Button position updates to stay above drawer.

### 23.4. Hover Menu for Layer Selection

- **Scenario**: Desktop users can access full layer menu via hover.
- **Steps**:
  1.  On desktop, hover over **Satellite Preview** button.
  2.  **Check**: Layer selection menu appears with all available layers.
  3.  Click a different satellite layer from menu.
  4.  **Check**: Map switches to selected layer.
  5.  **Check**: Preview button does NOT scale/grow during hover.
  6.  Move mouse away.
  7.  **Check**: Menu disappears.

## 24. Cross-City Navigation Camera Flight (Recent Fix - Jan 17)

### 24.1. Camera Flies to Different City

- **Scenario**: Clicking contribution in different city triggers camera flight.
- **Steps**:
  1.  Navigate to **Paris** and zoom in to street level (zoom 18+).
  2.  Open **"Latest Contributions"** panel.
  3.  Click contribution from **Lyon** (different city).
  4.  **Check**: Camera flies to Lyon (map animates/moves).
  5.  **Check**: Target overlay is selected and visible.
  6.  **Check**: Map is zoomed to appropriate level for overlay.

### 24.2. Same-City Navigation Preserves Zoom

- **Scenario**: Navigating within same city respects current zoom level.
- **Steps**:
  1.  Load a city and zoom to street level.
  2.  Click another overlay in the **same city** via panel.
  3.  **Check**: Camera pans to overlay without forcing zoom change.
  4.  **Check**: Current zoom level is preserved if already at appropriate level.
  5.  **Regression**: Click multiple overlays in same city.
  6.  **Check**: Navigation remains smooth without unnecessary zoom resets.

### 24.3. Cross-Country Navigation

- **Scenario**: Navigate between countries via side menu.
- **Steps**:
  1.  View project in **France** at high zoom.
  2.  Open side menu and navigate to contribution in **USA**.
  3.  **Check**: Camera flies across countries to USA.
  4.  **Check**: No freezing or stuttering during flight.
  5.  **Check**: Correct overlay is selected upon arrival.
  6.  **Regression**: Try navigating via city markers.
  7.  **Check**: City marker navigation also works correctly cross-country.

## 25. Progressive Overlay Queuing (Recent Optimization - Jan 18)

### 25.1. Smooth Overlay Loading Without Frame Drops

- **Scenario**: Overlays load progressively when entering viewport without freezing.
- **Steps**:
  1.  Zoom out to view level (low zoom).
  2.  Zoom in rapidly to a dense area (e.g., city center with 50+ overlays).
  3.  **Check**: Overlays "pop in" sequentially, not all at once.
  4.  **Check**: Map remains responsive during loading (can pan/zoom).
  5.  **Check**: No browser freezing or stuttering.
  6.  **Regression**: Monitor browser DevTools Performance panel.
  7.  **Check**: No major frame drops during overlay creation.

### 25.2. Mode Switch Performance at Scale

- **Scenario**: Switching modes remains fast regardless of overlay count.
- **Steps**:
  1.  Navigate to city with **50+ overlays** at high zoom.
  2.  Switch from **View Mode** to **Moderation Mode**.
  3.  **Check**: Mode switch completes in under 200ms.
  4.  Switch back to **View Mode**.
  5.  **Check**: Switch remains fast (no degradation).
  6.  Repeat mode switch 5-10 times rapidly.
  7.  **Check**: Performance remains consistent (no 15% slowdown regression).

### 25.3. Viewport Pruning During Pan

- **Scenario**: Off-screen overlays are progressively removed during panning.
- **Steps**:
  1.  Load multiple cities with overlays at high zoom.
  2.  Pan significantly to move some overlays off-screen.
  3.  **Check**: Off-screen overlay images are removed from DOM.
  4.  **Check**: Markers for off-screen overlays are removed.
  5.  Open browser DevTools Elements panel and inspect `.leaflet-overlay-pane`.
  6.  **Check**: Element count decreases as overlays leave viewport.
  7.  **Regression**: Pan back to original location.
  8.  **Check**: Overlays re-render correctly when returning to viewport.

## 26. Standalone Project Marker Stability (Recent Fix - Jan 13)

### 26.1. New Marker Survives Zoom Operations

- **Scenario**: Newly created standalone project marker doesn't crash on zoom.
- **Steps**:
  1.  Enter **Edit Mode**.
  2.  Create a new standalone project (no overlays).
  3.  Submit the project form (marker appears on map).
  4.  Immediately zoom in using scroll wheel.
  5.  **Check**: No browser crash or console errors.
  6.  **Check**: Marker remains visible and animates smoothly.
  7.  Zoom out.
  8.  **Check**: No crash occurs during zoom out.

### 26.2. Marker Persistence at Low Zoom in Edit Mode

- **Scenario**: Local markers persist when zooming below viewport threshold in edit mode.
- **Steps**:
  1.  Enter **Edit Mode**.
  2.  Create or view standalone project markers.
  3.  Zoom out to zoom level **12 or lower** (below VIEWPORT_LOAD_THRESHOLD).
  4.  **Check**: Markers remain visible (not cleared).
  5.  Pan around at low zoom.
  6.  **Check**: Markers stay on map.
  7.  Switch to **View Mode**.
  8.  **Check**: Only approved markers remain visible (pending ones hidden).

## 27. Event-Driven Accordion Scrolling (Recent Fix - Jan)

### 27.1. Marker Click Triggers Panel Scroll

- **Scenario**: Clicking markers triggers appropriate panel scrolling.
- **Steps**:
  1.  Click a **city marker** on map.
  2.  **Check**: Side panel scrolls to show city accordion.
  3.  **Check**: City accordion expands.
  4.  Click a **standalone project marker**.
  5.  **Check**: Panel scrolls to project within city.
  6.  **Check**: Project accordion expands.

### 27.2. Overlay Click Expands and Scrolls

- **Scenario**: Clicking overlay on map navigates panel to overlay details.
- **Steps**:
  1.  Click an **overlay** on the map.
  2.  **Check**: Panel finds containing city and expands it.
  3.  **Check**: Panel finds containing project and expands it.
  4.  **Check**: Panel scrolls to show overlay details.
  5.  **Regression**: Click different overlay in different city.
  6.  **Check**: Panel navigates to new city/project/overlay correctly.

### 27.3. Approval Stability (No Bouncy Scrolling)

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

## 28. Completion Status Filtering (Recent Fix - Feb 11)

### 28.1. FilterControl Works at All Zoom Levels

- **Scenario**: Completion status filters apply to both markers (low zoom) and full overlay images (high zoom).
- **Steps**:
  1.  Navigate to a city with multiple overlays in **View Mode**.
  2.  Ensure map shows a mix of proposed, planned, in-progress, and completed overlays.
  3.  Zoom to **marker level** (zoom < MIN_ZOOM_FOR_OVERLAYS).
  4.  Click **Filter button** (pi-filter icon).
  5.  Uncheck **"Proposed"** (yellow) status.
  6.  **Check**: Yellow markers disappear from map.
  7.  **Check**: Other status markers remain visible.
  8.  Zoom to **overlay level** (zoom >= MIN_ZOOM_FOR_OVERLAYS).
  9.  **Check**: Full overlay images with "proposed" status are hidden.
  10. **Check**: Only overlays matching checked statuses are visible.
  11. **Regression**: Toggle filters on and off multiple times.
  12. **Check**: Overlays correctly appear/disappear at both zoom levels.

### 28.2. Filter State Persists Across Zoom

- **Scenario**: Filter selections persist when zooming in and out.
- **Steps**:
  1.  Set filters to hide **"In Progress"** and **"Completed"** statuses.
  2.  Verify filtered markers at low zoom.
  3.  Zoom in to overlay level.
  4.  **Check**: Filter state is preserved (same overlays hidden).
  5.  Zoom out and back in.
  6.  **Check**: Filters remain applied consistently.
  7.  Reset filters (check all statuses).
  8.  **Check**: All overlays/markers become visible again.

## 29. Google Auth Error Handling (Recent Fix - Feb 14)

### 29.1. Email Conflict Handling

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

## 30. City Marker Opacity State Management (Recent Fix - Feb 17)

### 30.1. Marker Opacity Resets When Clicking Different City

- **Scenario**: Previously selected city marker returns to default opacity when selecting a new city.
- **Steps**:
  1.  Navigate to a country with multiple cities.
  2.  Click **City Marker A** (marker becomes opaque).
  3.  **Check**: City Marker A is at max opacity (hover state).
  4.  Click **City Marker B** (different city).
  5.  **Check**: City Marker B is now at max opacity.
  6.  **Check**: City Marker A returns to default (semi-transparent) opacity.
  7.  **Regression**: Hover over City Marker A.
  8.  **Check**: Opacity increases on hover, returns to default on mouseout (not stuck at max).

### 30.2. Marker Opacity Updates via CurrentLocationPanel

- **Scenario**: City marker opacity updates correctly when navigating via panel instead of map click.
- **Steps**:
  1.  Click a **City Marker** of country with multiple cities to open the CurrentLocationPanel.
  2.  Click on the blue country name in the panel to show the list of cities in that country.
  3.  Click on a city from the list of cities.
  4.  **Check**: Corresponding city marker on map becomes opaque (max opacity).
  5.  **Check**: Map flies to selected city.
  6.  Click on the blue country name in the panel again to show the list of cities in that country.
  7.  Click on another city in the city list.
  8.  **Check**: New city marker becomes opaque.
  9.  **Check**: Previous city marker returns to default opacity.
  10. **Regression**: Mix navigation methods (click marker, then use panel, then marker again).
  11. **Check**: Opacity updates consistently regardless of navigation method.

## 31. Automatic Satellite Layer Switching (Recent Feature - Feb 17)

### 31.1. Auto-Switch When Panning to France

- **Scenario**: Map automatically switches to France satellite layer when panning into French territory.
- **Steps**:
  1. Start in **Satellite** mode (global ESRI layer).
  2. Verify layer is set to "Satellite" in UI.
  3. Pan the map to **Paris, France**.
  4. Wait for `moveend` event to fire (stop panning).
  5. **Check**: Tile layer automatically switches to **France** high-res layer.
  6. **Check**: France layer tiles are loaded and visible.
  7. **Check**: UI still shows "Satellite" (not "France" - country layers are hidden from UI).

### 31.2. Auto-Switch When Panning to Switzerland

- **Scenario**: Map automatically switches to Switzerland satellite layer when panning into Swiss territory.
- **Steps**:
  1. Start at **France** in Satellite mode.
  2. Pan the map to **Zurich, Switzerland**.
  3. Wait for `moveend` event to fire.
  4. **Check**: Tile layer automatically switches to **Switzerland** layer.
  5. **Check**: Swiss layer tiles are loaded and visible.
  6. **Regression**: Zoom in and out.
  7. **Check**: Layer remains Switzerland (doesn't switch back).

### 31.3. Fallback to ESRI Outside Country Borders

- **Scenario**: Map falls back to global ESRI when viewing areas without country-specific layers.
- **Steps**:
  1. Start in France in Satellite mode (France layer active).
  2. Pan to **London, UK** (no UK-specific layer).
  3. Wait for `moveend` event.
  4. **Check**: Tile layer automatically switches back to **ESRI** (global).
  5. **Check**: ESRI tiles load correctly.
  6. Pan to **New York, USA**.
  7. **Check**: Layer remains on ESRI.

### 31.4. No Auto-Switch in Plan Mode

- **Scenario**: Auto-switching only happens in Satellite mode, not Plan mode.
- **Steps**:
  1. Set map to **Plan (OSM)** mode.
  2. Pan to France, Switzerland, and other countries.
  3. **Check**: Layer remains on Plan (OSM) throughout.
  4. **Check**: No automatic switching occurs.
  5. Switch to Satellite mode.
  6. **Check**: Auto-switching resumes based on current location.

### 31.5. Simplified Layer Selection Menu

- **Scenario**: UI only shows Plan and Satellite options (no manual country selection).
- **Steps**:
  1. Open satellite layer selection menu (hover or right-click preview button).
  2. **Check**: Menu shows exactly **2 options**: "Plan" and "Satellite".
  3. **Check**: NO France or Switzerland options in menu (authenticated users).
  4. Click between Plan and Satellite.
  5. **Check**: Toggle works correctly.

### 31.6. Authentication Required for Country Layers

- **Scenario**: Unauthenticated users stay on ESRI layer even when in France/Switzerland.
- **Steps**:
  1. Log out or open in incognito window (unauthenticated).
  2. Switch to Satellite mode.
  3. Pan to **Geneva, Switzerland**.
  4. **Check**: Layer remains on global **ESRI** (doesn't switch to Switzerland).
  5. Pan to **Nice, France**.
  6. **Check**: Layer remains on global **ESRI**.
  7. Log in with authenticated account.
  8. **Check**: Layer automatically switches to **France**.

### 31.7. Cross-Border Navigation

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

### 31.8. No Manual Country Switching on City Click

- **Scenario**: Clicking city markers no longer triggers satellite layer changes.
- **Steps**:
  1. Set to Satellite mode with ESRI layer active.
  2. Click a **city marker in France**.
  3. **Check**: Map pans to city.
  4. **Check**: Layer switches to France **only** when moveend event fires (based on location).
  5. **Regression**: Verify layer didn't switch immediately on click (before map moved).

### 31.9. Manual Satellite Preview Toggle (Recent Fix - Feb 18)

- **Scenario**: Manually switching to Satellite mode immediately applies the correct country layer.
- **Steps**:
  1.  Start in **Plan** mode.
  2.  Navigate to a location in **France** (e.g., Paris).
  3.  Click the **Satellite Preview** button.
  4.  **Check**: Map switches immediately to **France** satellite layer.
  5.  **Check**: Map does NOT briefly show ESRI layer before switching.
  6.  **Regression**: Navigate to a location without specific layer (e.g., Spain).
  7.  Click Satellite Preview.
  8.  **Check**: Map switches to **ESRI** layer.

### 31.10. Cooldown Satellite Toggle (Leading Edge Debounce - Feb 18)

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

## 32. Overlay Rendering Performance (Recent Optimization - Feb 18)

### 32.1. Batched Overlay Rendering

- **Scenario**: Overlays in view mode are rendered in batches, not individually.
- **Steps**:
  1.  Navigate to a city with **many overlays** (e.g., 20+) in **View Mode**.
  2.  Zoom out until overlays are replaced by markers (or unloaded).
  3.  Zoom back in to trigger overlay rendering.
  4.  **Check**: Overlays appear smoothly without stalling the browser.
  5.  **Regression**: Verify no "flickering" where overlays appear one by one slowly. They should appear in chunks or all at once.

## 34. Admin: Manual Image Pruning (Feature - Feb 21)

- **Location**: `/admin/reports` page, top-right of the page header. The entire `/admin/*` route requires admin role (enforced by the router guard), so no additional visibility check is needed.

### 34.1. Successful Prune

- **Scenario**: Admin triggers a prune when scheduled deletions are due.
- **Steps**:
  1. Log in as admin. Navigate to `/admin/reports`.
  2. Click **"Prune Images"**. **Check**: Button shows a loading spinner while the request is in flight.
  3. **Check**: A success toast appears with the deleted and failed counts (e.g. `2 deleted, 0 failed`).
  4. **Check**: Button returns to its normal (non-loading) state after completion.

### 34.2. Prune with No Pending Deletions

- **Scenario**: Admin triggers a prune when nothing is scheduled yet.
- **Steps**:
  1. Navigate to `/admin/reports` and click **"Prune Images"**.
  2. **Check**: Success toast appears with `0 deleted, 0 failed`.

### 34.3. Toast Availability on Admin Pages (Regression)

- **Scenario**: Toasts must work on all pages, not just the map home page.
- **Checks**:
  1. Perform any action on `/admin/reports` that triggers a toast (e.g. clear reports, ban user, prune images).
  2. **Check**: Toast notification appears correctly.
  3. Navigate to `/admin/user/:userId` and perform a deletion.
  4. **Check**: Toast notification appears correctly.

## 34. Undo/Redo Keyboard Shortcuts (Refactor - Feb 22)

### 34.1. Undo/Redo Works on First Edit Mode Entry

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
  10. **Check**: Undo still works — no duplicate event listeners, no missed registration.

## 33. isModified / pendingModsStore Sync (Fix - Feb 20)

### 33.1. Caption Change Submits Correctly

- **Scenario**: Changing only the caption of an approved overlay opens a valid submission dialog with the caption diff.
- **Steps**:
  1.  Enter **Edit Mode** at high zoom. Select an **approved** overlay that has no existing unsaved changes.
  2.  Open the overlay info / edit popup.
  3.  Change the **caption** field and blur the input.
  4.  **Check**: Overlay marker turns **orange** (isModified = true).
  5.  Open the overlay info / edit popup again.
  6.  **Check**: The input field contains the new caption.

## 34. Replacement Image Upload Appears on Map (Fix - Feb 22)

### 34.1. Replacement Image Appears on Map After Upload

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

### 34.2. Regular (Non-Replacement) New Overlay Also Appears

- **Scenario**: Uploading the very first image on a standalone project correctly displays it.
- **Steps**:
  1.  Enter **Edit Mode**. Navigate to a **standalone project** (no overlays yet).
  2.  Open the project popup and click **Add Image** (or equivalent).
  3.  Select an image file and confirm.
  4.  **Check**: The overlay image **appears on the map** immediately.
  5.  **Check**: The standalone project marker is **removed** once the overlay appears.

## 35. City Rendering Core Refactor (Feb 23)

### 35.1. Viewport Path — Full Overlay Rendering

- **Scenario**: Pan/zoom loads overlays via the viewport manager.
- **Steps**:
  1.  Zoom into a city past **MIN_ZOOM_FOR_OVERLAYS**.
  2.  **Check**: Overlay images appear (not just dot markers).
  3.  **Check**: Overlay marker colors correctly reflect status (e.g., yellow for `hasPendingChanges`).
  4.  Zoom back out below threshold.
  5.  **Check**: Images disappear, dot markers appear at centroids.
  6.  Zoom in again.
  7.  **Check**: Images re-appear correctly (no blank map).

### 35.2. Navigation Path — City Marker Click

- **Scenario**: Clicking a city marker loads overlays via `cityDataRenderer.loadAndRenderCityData`.
- **Steps**:
  1.  At high zoom, click a **City Marker**.
  2.  **Check**: Overlay images load (`forceFullOverlays = true` path).
  3.  **Check**: Standalone markers appear for projects with no overlays.
  4.  At low zoom, click a City Marker.
  5.  **Check**: Dot markers appear (not images).
  6.  **Regression**: Verify no circular dependency errors in console.

### 35.3. Mode Switch Preserves Rendering

- **Scenario**: Switching mode after viewport load re-renders correctly.
- **Steps**:
  1.  Load a city in **View Mode** at high zoom.
  2.  Switch to **Edit Mode**.
  3.  **Check**: `hasPendingChanges` / `suggestedCorners` are refreshed via batch update.
  4.  **Check**: Marker colors update immediately (yellow for pending changes).
  5.  Switch back to **View Mode**.
  6.  **Check**: Markers return to timeline colors.

## 36. Cross-City Overlay Marker Cleanup (Recent Fix - Feb 23)

### 36.1. Overlay Markers Cleared When Switching to Overlay-Less City

- **Scenario**: Navigating from a city with overlays to one with only standalone projects clears old overlay markers.
- **Steps**:
  1.  Navigate to **City A** (has overlays) at zoom 14+. Overlay images and markers appear.
  2.  Click **City B** marker (a nearby city with only standalone projects, no overlays).
  3.  **Check**: City A's overlay images are removed from the map.
  4.  **Check**: City A's overlay markers (dots/icons) are removed from the map.
  5.  **Check**: City B's standalone project markers appear.
  6.  **Regression**: Click City A again.
  7.  **Check**: City A's overlays and markers re-render correctly (no duplicates).

### 36.2. Cross-City Zoom Without Click (Viewport Loading)

- **Scenario**: Zooming from one city to a nearby one via viewport loading preserves marker consistency.
- **Steps**:
  1.  Click **City A** marker → overlays load at zoom 14+.
  2.  Unzoom to zoom level 10 or below.
  3.  Zoom back into **City B** (nearby, without clicking its marker).
  4.  At **zoom 13**: **Check** interactive overlay markers appear for City B. (Hovering highlights them).
  5.  At **zoom 14**: **Check** overlay images AND their interactive markers are both visible.
  6.  **Regression**: Unzoom to 12, zoom back to 14. Verify markers still appear.

### 36.3. Upfront Overlay Markers on City Navigation

- **Scenario**: Overlay markers appear instantly and are fully interactive when clicking a city marker, before images load.
- **Steps**:
  1.  Click a **City Marker** at zoom 14+.
  2.  **Check**: Interactive overlay markers appear **immediately** (alongside standalone project markers) and respond to hover.
  3.  **Check**: Overlay images load in the background and appear after a short delay.
  4.  **Check**: Once images are loaded, markers remain interactive and visible (no flash/disappearance).
  5.  **Regression**: Clear browser cache and repeat — verify markers appear before images on slow connection.

### 36.5. No Stale Country Tile Requests After Plan→Satellite Round-Trip

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

### 36.4. Standalone Project Marker Cleanup on City Switch

- **Scenario**: Old standalone project markers are removed instantly when navigating to a new city.
- **Steps**:
  1.  Click a **City Marker** for a city that has standalone projects (projects without overlays).
  2.  Verify standalone project markers appear on the map.
  3.  Click a **different City Marker**.
  4.  **Check**: Old standalone project markers disappear **instantly** (no ~500ms delay).
  5.  **Check**: New city's standalone project markers appear correctly.

## 37. Vector Tile Backend (Step 1)

### 37.1. MVT Tile Endpoint

- **Scenario**: The `/api/tiles/projects/:z/:x/:y` endpoint returns valid MVT binary data.
- **Steps**:
  1.  Request a tile for a known location with approved projects that have geometry (e.g. `/api/tiles/projects/12/2064/1401`).
  2.  **Check**: Response `Content-Type` is `application/x-protobuf`.
  3.  **Check**: Response body is non-empty binary.
  4.  **Check**: Decode the MVT — verify it contains a `project-shapes` layer with features.
  5.  **Check**: Decode the MVT — verify it contains an `overlay-footprints` layer with features for tiles covering approved overlays.
  6.  Request a tile over an area with no projects. **Check**: Response is `204 No Content`.
  7.  Request with invalid coordinates (e.g. `z=-1`). **Check**: Response is `400`.

### 37.2. Project Points GeoJSON Endpoint

- **Scenario**: `/api/projects/points` returns the correct GeoJSON FeatureCollection.
- **Steps**:
  1.  Request `/api/projects/points`.
  2.  **Check**: Response `Content-Type` is `application/geo+json`.
  3.  **Check**: All features have `geometry.type === "Point"` and `properties.id`, `name`, `tags`.
  4.  **Check**: No feature corresponds to a project with `geometry_size_m >= 5000` (large geometry projects are excluded).
  5.  **Check**: Projects with `geometry_size_m IS NULL` (no geometry) ARE included.
  6.  **Check**: Only `status = 'approved'` projects are returned (no pending/rejected).

### 37.3. geometry_size_m Computed on Project Save

- **Scenario**: When a project with geometry is saved, `geometry_size_m` is correctly populated.
- **Steps**:
  1.  Create or update a project with a small geometry (a short line, e.g. < 500m).
  2.  **Check**: `geometry_size_m` in the DB is a small positive number (e.g. < 500).
  3.  Create or update a project with a large geometry spanning > 5km (e.g. a long railway line).
  4.  **Check**: `geometry_size_m` is > 5000.
  5.  **Check**: This project does NOT appear in `/api/projects/points`.
  6.  Update a project to remove its geometry (set to null).
  7.  **Check**: `geometry_size_m` is NULL.
  8.  **Check**: This project now appears in `/api/projects/points`.

### 37.4. getOverlaysInViewport tRPC Procedure

- **Scenario**: `viewport.getOverlaysInViewport` returns overlays for the given bbox.
- **Steps**:
  1.  Call with a bbox that covers a known city with approved overlays, `mode: "view"`.
  2.  **Check**: Returns overlays whose centroid falls within the bbox.
  3.  **Check**: No pending/rejected overlays are returned in view mode.
  4.  Call with `mode: "edit"` as an authenticated user with pending overlays in bbox.
  5.  **Check**: Own pending overlays are included. Others' pending overlays are not.
  6.  Call with `mode: "moderation"` as a moderator.
  7.  **Check**: All pending overlays in bbox are included (not just own).
  8.  Call with `mode: "moderation"` while unauthenticated. **Check**: Returns `UNAUTHORIZED` error.
  9.  Call with a bbox outside any known project area. **Check**: Returns empty array.
  10. **Regression**: Switch to a city with **no** standalone projects — verify old markers are still removed instantly.

---

## 38. Vector Tile View Mode (Step 2)

### 38.1. MapLibre Always-On Base Map

- **Scenario**: Page loads for the first time (no toggle, MapLibre is mandatory).
- **Checks**:
  1. The MapLibre liberty-style base map renders immediately on page load with no fallback flash.
  2. No "Plan / Satellite / Vector tiles" toggle is visible in the user menu.
  3. The satellite layer switcher still works correctly alongside MapLibre.

### 38.2. Cluster Source (`/api/projects/points`)

- **Scenario**: View mode at low zoom over a city with approved projects.
- **Checks**:
  1. MapLibre cluster circles appear at zoom ≤ 10 where multiple projects are nearby.
  2. Clicking a cluster circle zooms in and expands it into sub-clusters or individual points.
  3. Individual unclustered-point circles appear between zoom 10 and 13.
  4. Cluster circles disappear above zoom 13 (replaced by overlay images).
  5. Projects with `geometry_size_m >= 5000` do NOT appear as cluster points (they are discoverable as lines in the MVT layer).
  6. Projects with no geometry (`geometry_size_m IS NULL`) DO appear as cluster points.

### 38.3. MVT Project Shapes Layer

- **Scenario**: View mode at zoom ≥ 9 over a city with projects that have polygon/line geometry.
- **Checks**:
  1. Project-shape lines/polygons render as blue lines from the `project-shapes` MVT layer.
  2. Clicking a shape opens the project info popup.
  3. Panning away and back: shapes reload from tiles without user interaction.

### 38.4. Overlay Footprints MVT Layer

- **Scenario**: View mode at zoom ≥ 14 over a city with approved overlays.
- **Checks**:
  1. Overlay footprint outlines (blue border) appear as soon as tiles load, **before** the Leaflet image finishes loading.
  2. Clicking an overlay footprint outline opens the project info popup.
  3. Pointer cursor appears on hover over the footprint outline.

### 38.5. vectorTileSync — Idle-Driven Leaflet Overlay Creation

- **Scenario**: Zoom to ≥ 14 over a city with approved overlays in view mode.
- **Checks**:
  1. Leaflet DistortableImageOverlay images appear for overlays in the viewport after MapLibre fires `idle`.
  2. No overlay markers (dot icons) are created in view mode — click interaction is handled by the `overlay-footprints` MapLibre layer.
  3. Pan away: overlays that leave the viewport are removed from the map.
  4. Pan back: overlays re-appear without a page refresh.
  5. Zoom below 14: all view-mode overlay images are removed (footprints layer hides via MapLibre minzoom).

### 38.6. Mode Switch — View → Edit

- **Scenario**: User is in view mode (vectorTileSync-managed overlays on map), then switches to edit mode.
- **Checks**:
  1. vectorTileSync-managed Leaflet overlays are cleared.
  2. `refreshViewport(true)` is triggered and city-based overlay loading runs for the current viewport.
  3. Edit-mode features appear (toolbar on overlays, pending overlay markers).
  4. No duplicate overlays (neither double Leaflet layers nor double markers).

### 38.7. Mode Switch — Edit → View

- **Scenario**: User is in edit mode with overlays loaded, then switches to view mode.
- **Checks**:
  1. Edit-mode overlays (pending + approved) are cleared from the map.
  2. No city-based loading runs after the switch; the next MapLibre `idle` event repopulates view-mode overlays.
  3. Standalone project markers are cleared.
  4. `loadedCityIds` is empty after switching to view (no city-keyed cache is consumed).

### 38.8. Project Points Store Refresh

- **Scenario**: A moderator approves a project while the map is open (simulated by calling `fetchProjectPoints()` manually).
- **Checks**:
  1. The cluster source updates without a page reload — new project point appears in the appropriate zoom range.
  2. Previously clustered area re-clusters correctly after `source.setData()`.

### 38.9. `GET /api/projects/points` Endpoint

- **Scenario**: Backend unit test for the projects/points endpoint.
- **Checks**:
  1. Returns a valid GeoJSON `FeatureCollection`.
  2. Only includes projects with `status = 'approved'`.
  3. Excludes projects where `geometry_size_m >= 5000`.
  4. Includes projects where `geometry_size_m IS NULL` (no geometry → standalone).
  5. Each feature has `id`, `name`, `tags` properties and a Point geometry with `[lng, lat]` coordinates.
  6. Returns `Content-Type: application/geo+json` with `Cache-Control: public`.

### 38.10. `GET /api/tiles/projects/:z/:x/:y` Endpoint

- **Scenario**: Request an MVT tile that covers a known city.
- **Checks**:
  1. Returns `Content-Type: application/x-protobuf` with HTTP 200.
  2. The tile contains a `project-shapes` source layer with approved project geometries.
  3. The tile contains an `overlay-footprints` source layer with approved overlay corner polygons; each feature carries `c0_lat…c3_lng`, `filename`, `project_id` properties.
  4. An empty tile area returns HTTP 204 (no body).
  5. Invalid coordinates (e.g., `z=-1`) return HTTP 400.

### 38.11. `GET /api/projects/points` Grid Deduplication

- **Scenario**: Multiple approved projects exist within ~500m of each other.
- **Checks**:
  1. The endpoint returns fewer features than the total number of approved projects when several share the same ~0.005° grid cell.
  2. Each returned feature still has valid `id`, `name`, `tags`, and `coordinates`.
  3. Projects that are far apart (different grid cells) are all represented — no legitimate points are dropped.
  4. The MapLibre cluster source still renders correctly with the deduplicated data (clusters at low zoom, individual dots at zoom ≥ 10).

### 38.12. Bbox-Based Edit/Moderation Loading (Step 3)

- **Scenario**: In Edit or Moderation mode, overlays and standalone project markers load spatially from the viewport bbox rather than by city boundaries.
- **Steps**:
  1. Enter **Edit Mode** while zoomed in to street level (above `VIEWPORT_LOAD_THRESHOLD`).
  2. Pan the map across a city boundary so that contributions from two cities are in view.
  3. Observe that overlays and standalone project markers from **both** cities appear without needing to click a city marker.
  4. Zoom out below `VIEWPORT_LOAD_THRESHOLD`. Overlays and standalone markers should clear.
  5. Zoom back in. Data should reload via a fresh bbox fetch.
- **Checks**:
  1. Overlays from multiple cities appear simultaneously when their corners are within the viewport — no city boundary limitation.
  2. Standalone project markers (projects with zero overlays) appear for projects whose `center_coordinate` falls within the viewport.
  3. In Edit mode, the user's own pending/local projects appear alongside approved projects.
  4. In Moderation mode, all pending projects (from any user) appear.
  5. Panning a short distance (within the quantized bbox key) does NOT trigger a new backend fetch.
  6. Panning a longer distance triggers a new fetch and renders the new viewport's data.

### 38.13. Cluster Source Augmentation in Edit/Moderation

- **Scenario**: The MapLibre cluster source shows both approved projects (from `/api/projects/points`) and pending projects (from the bbox tRPC fetch) when in Edit or Moderation mode.
- **Steps**:
  1. Create a new project (pending, not yet approved) with a center coordinate.
  2. Switch to **Edit Mode**.
  3. Zoom out to cluster level (zoom ≤ 10).
- **Checks**:
  1. The pending project's center point appears in the cluster source (either as part of a cluster or as an individual dot).
  2. Switch to **View Mode** — the pending project disappears from the cluster source (only approved projects remain).
  3. Switch back to **Edit Mode** — the pending project reappears in the cluster source.

### 38.14. Mode Switch With Bbox Loading

- **Scenario**: Switching between view, edit, and moderation modes correctly transitions between tile-driven and bbox-driven rendering.
- **Steps**:
  1. Start in **View Mode** at street level. Overlays are rendered by vectorTileSync (MVT idle sync).
  2. Switch to **Edit Mode**.
  3. Observe overlays reload from the bbox tRPC fetch. User's pending overlays also appear.
  4. Move an overlay. Switch to **View Mode** — overlay returns to database position.
  5. Switch back to **Edit Mode** — overlay returns to the cached (moved) position.
  6. Switch to **Moderation Mode** — all users' pending content appears.
- **Checks**:
  1. No flash of empty content during mode transitions (overlays not visible in new mode are hidden before fetch).
  2. Standalone project markers for local (unsaved) projects appear immediately after switching to Edit mode.
  3. The cluster source is restored to base (approved-only) data when returning to View mode.

---

## 39. Vector Tile Cleanup — Leaflet City Marker Removal (Step 4)

### 39.1. City List Panels Remain Functional

- **Scenario**: `citiesWithProjects` ref is still populated after the Leaflet city marker layer was removed.
- **Steps**:
  1. Open the app. Ensure no login (view mode).
  2. Open **CurrentLocationPanel** / **MarkerHelpButton** / **PopupContainer**.
  3. **Check**: City list is populated correctly (cities with approved projects visible).
  4. Log in and switch to **Edit Mode**.
  5. **Check**: City list updates to include cities with your own pending items.
  6. Switch to **Moderation Mode** (if moderator).
  7. **Check**: City list shows cities with any pending items in your jurisdiction.

### 39.2. `activateCity` / `smartZoomToCity` Still Work

- **Scenario**: Clicking a city entry in the panel triggers the correct city activation flow.
- **Steps**:
  1. Open **CurrentLocationPanel** and click a city name.
  2. **Check**: Map flies to that city's content bounds.
  3. **Check**: Overlays and standalone markers for the city load (as defined by current mode).
  4. **Check**: Panel scrolls to show city accordion.
  5. **Regression**: Click a city in a **different country** from the currently loaded one.
  6. **Check**: Map flies to the new city; no ghost markers from the old country remain.

### 39.3. Mode Watcher Refreshes City List

- **Scenario**: Switching mode triggers `buildCitiesForCurrentMode` and updates the city list.
- **Steps**:
  1. Load map in **View Mode**. Note the number of cities in the panel list.
  2. Switch to **Edit Mode**.
  3. **Check**: City list updates (may include extra cities with your pending items).
  4. Switch back to **View Mode**.
  5. **Check**: City list returns to approved-only cities.
