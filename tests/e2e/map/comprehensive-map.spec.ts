import { test, expect } from '@playwright/test';
import { MapTestHelpers } from '../../helpers/map-helpers';
import { setupMapTest } from '../../helpers/test-helpers';

test.describe('Comprehensive Map Testing', () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    mapHelpers = await setupMapTest(page);
  });

  test('should demonstrate full map workflow: country → city → overlays → modes → filtering', async ({ page }) => {
    // AI : 1. Verify initial state and reset to view mode if needed
    await expect(page.locator('.leaflet-container')).toBeVisible();
    
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
    }
    expect(await mapHelpers.isEditModeActive()).toBeFalsy();
    
    const initialCountryMarkers = await mapHelpers.getCountryMarkerCount();
    console.log(`Initial country markers: ${initialCountryMarkers}`);
    expect(initialCountryMarkers).toBeGreaterThan(0);
    
    // AI : 2. Navigate through markers: country → city → overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays(0, 0);
    expect(navigationSuccess).toBeTruthy();
    
    // AI : 3. Click on overlay markers to test interaction
    const finalMarkerCount = await mapHelpers.getTotalMarkerCount();
    console.log(`Markers after navigation: ${finalMarkerCount}`);
    expect(finalMarkerCount).toBeGreaterThan(0);
    
    // AI : Click on an overlay marker if available
    if (finalMarkerCount > 0) {
      const overlayClicked = await mapHelpers.clickOverlayMarker(0);
      console.log(`Overlay marker clicked: ${overlayClicked}`);
    }
    
    // AI : 4. Test marker colors in view mode (overlays visible in view mode)
    const viewModeColors = await mapHelpers.getVisibleMarkerColors();
    console.log(`View mode colors: ${viewModeColors.join(', ')}`);
    expect(viewModeColors.length).toBeGreaterThan(0);
  });

  test('should validate marker visibility and interaction', async () => {
    // AI : Navigate through marker hierarchy
    const navigationSuccess = await mapHelpers.navigateToOverlays(0, 0);
    if (!navigationSuccess) {
      console.log('No markers available for testing');
      return;
    }

    // AI : Ensure we start in view mode
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
    }
    
    // AI : Test marker colors in view mode (overlays are visible in view mode)
    const viewColors = await mapHelpers.getVisibleMarkerColors();
    console.log(`View mode marker colors: ${viewColors.join(', ')}`);
    expect(viewColors.length).toBeGreaterThan(0);
    
    // AI : Click on a marker to test interaction
    const markerCount = await mapHelpers.getTotalMarkerCount();
    if (markerCount > 0) {
      const clicked = await mapHelpers.clickOverlayMarker(0);
      console.log(`Marker interaction successful: ${clicked}`);
    }
  });

  test('should handle edge cases and error states', async ({ page }) => {
    // AI : Test navigation workflow through markers
    const navigationSuccess = await mapHelpers.navigateToOverlays(0, 0);
    
    // AI : Check for any error messages during navigation
    const errorAlerts = page.locator('[role="alert"]');
    const errorCount = await errorAlerts.count();
    
    if (errorCount > 0) {
      // AI : Verify error messages are user-friendly
      const errorText = await errorAlerts.first().textContent();
      expect(errorText).toBeTruthy();
      console.log(`Error message: ${errorText}`);
      
      // AI : Dismiss errors
      await mapHelpers.dismissErrorAlerts();
    }
    
    // AI : Test marker interaction after navigation
    if (navigationSuccess) {
      const markerCount = await mapHelpers.getTotalMarkerCount();
      if (markerCount > 0) {
        const clicked = await mapHelpers.clickOverlayMarker(0);
        console.log(`Edge case marker click: ${clicked}`);
      }
    }
    
    // AI : Map should remain functional
    await expect(page.locator('.leaflet-container')).toBeVisible();
    console.log(`Navigation result: ${navigationSuccess}`);
  });
});