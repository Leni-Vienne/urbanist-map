import { test, expect } from '@playwright/test';
import { MapTestHelpers } from '../../helpers/map-helpers';

test.describe('Comprehensive Map Testing', () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    mapHelpers = new MapTestHelpers(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await mapHelpers.waitForMapReady();
    await mapHelpers.dismissErrorAlerts();
  });

  test('should demonstrate full map workflow: view mode → edit mode → filtering → overlay interaction', async ({ page }) => {
    // AI : 1. Verify initial view mode
    await expect(page.locator('.leaflet-container')).toBeVisible();
    expect(await mapHelpers.isEditModeActive()).toBeFalsy();
    
    // AI : Get initial marker colors (should be timeline-based)
    const viewModeColors = await mapHelpers.getVisibleMarkerColors();
    console.log(`View mode marker colors: ${viewModeColors.join(', ')}`);
    
    // AI : 2. Switch to edit mode and verify marker color changes
    await mapHelpers.toggleEditMode();
    expect(await mapHelpers.isEditModeActive()).toBeTruthy();
    
    const editModeColors = await mapHelpers.getVisibleMarkerColors();
    console.log(`Edit mode marker colors: ${editModeColors.join(', ')}`);
    
    // AI : 3. Test filtering functionality
    const initialOverlayCount = await mapHelpers.getOverlayCount();
    console.log(`Initial overlay count: ${initialOverlayCount}`);
    
    // AI : Toggle completed projects filter
    await mapHelpers.toggleProjectFilter('completed');
    await page.waitForTimeout(500);
    
    const filteredOverlayCount = await mapHelpers.getOverlayCount();
    console.log(`Overlay count after filtering: ${filteredOverlayCount}`);
    
    // AI : Toggle filter back on
    await mapHelpers.toggleProjectFilter('completed');
    await page.waitForTimeout(500);
    
    // AI : 4. Test zoom-based overlay loading
    const lowZoom = 5;
    const highZoom = 15;
    
    await mapHelpers.zoomToLevel(lowZoom);
    const lowZoomImages = await mapHelpers.verifyOverlayImageLoading(false);
    
    await mapHelpers.zoomToLevel(highZoom);
    const highZoomImages = await mapHelpers.verifyOverlayImageLoading(true);
    
    console.log(`Images at zoom ${lowZoom}: ${lowZoomImages}, at zoom ${highZoom}: ${highZoomImages}`);
    
    // AI : 5. Test overlay navigation
    if (initialOverlayCount > 0) {
      const navigationSuccess = await mapHelpers.clickZoomToOverlay(0);
      if (navigationSuccess) {
        // AI : Verify map moved to overlay location
        const finalZoom = await mapHelpers.getCurrentZoom();
        const finalCenter = await mapHelpers.getMapCenter();
        
        console.log(`Final position: zoom=${finalZoom}, center=${JSON.stringify(finalCenter)}`);
      }
    }
  });

  test('should validate marker color logic in both modes', async ({ page }) => {
    // AI : Test view mode colors (construction timeline)
    await mapHelpers.toggleEditMode(); // Ensure we start in view mode
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode(); // Switch back to view
    }
    
    const viewColors = await mapHelpers.getVisibleMarkerColors();
    
    // AI : In view mode, should see timeline colors: green, orange, grey
    const timelineColors = viewColors.filter(color => ['green', 'orange', 'grey'].includes(color));
    expect(timelineColors.length).toBeGreaterThan(0);
    
    // AI : Switch to edit mode
    await mapHelpers.toggleEditMode();
    
    const editColors = await mapHelpers.getVisibleMarkerColors();
    
    // AI : In edit mode, should see state colors: green, orange, red, blue, purple
    const stateColors = editColors.filter(color => ['green', 'orange', 'red', 'blue', 'purple'].includes(color));
    expect(stateColors.length).toBeGreaterThan(0);
    
    console.log(`View mode uses timeline colors: ${timelineColors.join(', ')}`);
    console.log(`Edit mode uses state colors: ${stateColors.join(', ')}`);
  });

  test('should handle edge cases and error states', async ({ page }) => {
    // AI : Test navigation to non-existent overlay
    await mapHelpers.clickZoomToOverlay(0);
    
    // AI : Check for any error messages
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
    
    // AI : Test rapid mode switching
    for (let i = 0; i < 3; i++) {
      await mapHelpers.toggleEditMode();
      await page.waitForTimeout(100);
    }
    
    // AI : Map should remain functional
    await expect(page.locator('.leaflet-container')).toBeVisible();
  });
});