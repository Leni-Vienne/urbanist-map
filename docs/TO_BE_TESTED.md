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
