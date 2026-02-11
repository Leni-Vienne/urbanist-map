# Frontend Testing Specification (Playwright)

This document outlines the granular functional test scenarios required to ensure application stability. It focuses on reproducing complex user behaviors and preventing regression of specific historical bugs.

## 1. Map Visualization & Entity Behavior

### 1.1. Zoom-Dependent Rendering (The "Threshold" Test)

- **Scenario**: User zooms in from a high altitude to a street level.
- **Checks**:
  1.  At **Low Zoom (Country/Region)**: Verify `CityMarkers` are visible. Verify NO `OverlayMarkers` or `OverlayImages` are visible.
  2.  At **Mid Zoom (City)**: Verify `CityMarkers` disappear. Verify `OverlayMarkers` (dots/icons) appear.
  3.  At **High Zoom (Street)**: Verify `OverlayMarkers` are replaced by (or overlaid with) actual `OverlayImages` (distorted images on map).
- **Regression Focus**:
  - **Flicker**: Assert DOM elements for markers do not detach and reattach unnecessarily during minor zoom adjustments around the threshold (Visual instability).
  - **Disappearance**: Zoom out slightly and zoom back in; ensure images re-render immediately without needing a pan interaction.

### 1.2. City Marker Logic & Filtering

- **Scenario**: Switch between View, Edit, and Moderation modes.
- **Checks**:
  1.  **View Mode**: Ensure cities with _only_ pending items are **hidden**.
  2.  **Edit Mode**: Ensure cities containing _your_ pending items appear. Cities with _others'_ pending items must remain hidden.
  3.  **Moderation Mode**: Ensure cities with _anyone's_ pending items appear.
  4.  **Mixed State**: Determine a city with both Approved and Pending items. Verify it is visible in View mode, but interacting with it shows the correct subset of data.

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

## 3. Moderation & Admin Workflows

### 3.1. Contextual Filtering

- **Scenario**: Admin reviewing content in a specific city.
- **Steps**:
  1.  Enter **Moderation Mode**.
  2.  Click a **City Marker** that has pending items.
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

### 4.1. Panel-to-Map Navigation

- **Scenario**: Using the "Latest Overlays" or "Search" features.
- **Steps**:
  1.  Open "Latest Overlays" drawer.
  2.  Click an item.
  3.  **Check**: Map pans/zooms to the target.
  4.  **Regression**: Verify the **City Marker** for that location does NOT disappear during the flight or upon arrival.
  5.  **Regression**: Verify the target overlay is actually rendered (not culled aggressively).

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
  - City markers respect View Mode rules.
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

### 6.2. Standalone Project Marker Interaction (Regression)

- **Scenario**: User clicks a standalone project marker while the city was loaded via zoom (not click).
- **Steps**:
  1.  Zoom into a city (without clicking the city marker).
  2.  Ensure "Latest" tab is active.
  3.  Click a **Standalone Project Marker**.
  4.  **Check**:
      - Project Info Popup opens.
      - **Side Panel** switches to "Current Location" (Context switch).
      - **Side Panel** project list is updated.
      - **Side Panel** the clicked project is selected (accordion opens).

## 7. Active City Content Persistence (Recent Fix - Jan 13)

### 7.1. City Content Remains Loaded When Zooming Out

- **Scenario**: User selects a city and zooms out to view a distant project.
- **Steps**:
  1.  Click a **City Marker** to load its overlays and standalone project markers.
  2.  Zoom out beyond `VIEWPORT_LOAD_THRESHOLD`.
  3.  **Check**:
      - Active city's overlay markers and standalone markers remain visible on the map.
      - City marker for the active city remains visible even at high zoom levels.
  4.  **Regression**: Pan to a different area.
  5.  **Check**: Active city content is still loaded and visible (doesn't unload during panning).
  6.  Click a different city marker that is significantly far from the active city.
  7.  **Check**: Previous active city content is properly unloaded from the map, new city content loads.

### 7.2. Mode Switch Preserves Active City

- **Scenario**: User switches modes while a city is active.
- **Steps**:
  1.  Click a **City Marker** in View Mode.
  2.  Switch to **Edit Mode**.
  3.  **Check**: Active city content remains loaded and visible.
  4.  Switch to **Moderation Mode**.
  5.  **Check**: Active city content remains loaded with appropriate visibility filtering.

## 8. Standalone Project Marker Persistence (Recent Fix - Jan 13)

### 8.1. Markers Persist After Zoom Operations

- **Scenario**: New standalone project marker should persist after zoom in Edit Mode.
- **Steps**:
  1.  Enter **Edit Mode**.
  2.  Add a new standalone project or view existing ones.
  3.  Zoom out beyond `VIEWPORT_LOAD_THRESHOLD`.
  4.  **Check**: Standalone markers remain visible (not removed).
  5.  Zoom back in.
  6.  **Check**: Standalone markers are still visible and correctly positioned.

### 8.2. City Marker Click Restores Markers

- **Scenario**: Standalone markers reappear when clicking city marker.
- **Steps**:
  1.  Enter **Edit Mode**.
  2.  Load a city with standalone projects.
  3.  Zoom out and back in.
  4.  Click the **City Marker** again.
  5.  **Check**: Standalone markers are correctly restored (no duplicates).
  6.  **Regression**: Verify marker click handlers still work after restoration.

## 9. Map Zoom Animation Stability (Recent Fix - Jan 13)

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

## 10. Moderation Position Buttons (Recent Fix - Jan 13)

### 10.1. View Suggested Position Works From City Load

- **Scenario**: Position navigation buttons work correctly when city is loaded via city marker click.
- **Steps**:
  1.  Enter **Moderation Mode**.
  2.  Click a **City Marker** to load its overlays.
  3.  Select an overlay with pending changes to its position from the side panel.
  4.  Click **"View Suggested Position"** button.
  5.  **Check**: Overlay moves to suggested position on map.
  6.  **Check**: Overlay marker updates to show suggested location.
  7.  **Check**: Overlay marker turns from green to yellow.

### 10.2. View Approved Position Works From City Load

- **Scenario**: View approved position after viewing suggested.
- **Steps**:
  1.  Follow steps from 10.1 to view suggested position.
  2.  Click **"View Approved Position"** button.
  3.  **Check**: Overlay moves to approved position on map.
  4.  **Check**: Overlay marker updates to show approved location
  5.  **Check**: Overlay marker turns from yellow to green.
  6.  **Regression**: Test with overlays loaded via side menu (original working case).

## 11. Overlay Visibility Mode Switching (Recent Fix - Jan 13)

### 11.1. Pending Overlays Hide in View Mode

- **Scenario**: Pending overlays are properly hidden when switching from Moderation to View mode.
- **Steps**:
  1.  Enter **Moderation Mode**.
  2.  Click a city marker to load pending overlays.
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

## 13. Off-Screen Content Cleanup (Recent Fix - Jan 13)

### 13.1. Far Off-Screen Cities Are Unloaded

- **Scenario**: Map maintains good performance by unloading cities that are far outside the viewport.
- **Steps**:
  1.  Click multiple city markers to load their content.
  2.  Pan significantly far away (outside padded viewport bounds).
  3.  **Check**: Off-screen city overlays and markers are removed from map.
  4.  **Check**: `loadedCityIds` set is updated (city removed).
  5.  Pan back to the original city area.
  6.  **Check**: City content is re-loaded (fresh API call if needed).

### 13.2. Nearby Cities Remain Loaded

- **Scenario**: Cities within padded viewport bounds remain loaded during minor pans.
- **Steps**:
  1.  Load a city's content.
  2.  Pan slightly (still within padded bounds).
  3.  **Check**: City content remains loaded (no unnecessary reload).
  4.  **Regression**: Verify no performance issues from repeated bounds checks.

## 14. Performance Optimizations (Recent Fixes - Jan 12)

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

### 15.2. Tile Layer Persistence

- **Scenario**: Selected tile layer persists during map navigation operations.
- **Steps**:
  1.  Set a specific tile layer (e.g., satellite view).
  2.  Navigate to a city marker or contribution.
  3.  **Check**: Tile layer remains the same (doesn't auto-switch).
  4.  **Regression**: Manual tile layer switching still works correctly.

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
  3.  Click city marker or zoom to trigger map animation.
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
