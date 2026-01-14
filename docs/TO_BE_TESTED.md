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
