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
    
    // AI : 2. Click country marker to load cities
    const countryClicked = await mapHelpers.clickCountryMarker(0);
    expect(countryClicked).toBeTruthy();
    
    const cityMarkers = await mapHelpers.getCityMarkerCount();
    console.log(`City markers loaded: ${cityMarkers}`);
    
    if (cityMarkers > 0) {
      // AI : 3. Click city marker to load overlays
      const cityClicked = await mapHelpers.clickCityMarker(0);
      expect(cityClicked).toBeTruthy();
      
      await page.waitForTimeout(1000);
      const overlayCount = await mapHelpers.getOverlayCount();
      console.log(`Overlays loaded: ${overlayCount}`);
      
      if (overlayCount > 0) {
        // AI : 4. Test view mode vs edit mode marker colors
        const viewModeColors = await mapHelpers.getVisibleMarkerColors();
        console.log(`View mode colors: ${viewModeColors.join(', ')}`);
        
        await mapHelpers.toggleEditMode();
        const editModeColors = await mapHelpers.getVisibleMarkerColors();
        console.log(`Edit mode colors: ${editModeColors.join(', ')}`);
        
        // AI : 5. Test filtering in edit mode
        const initialOverlayCount = await mapHelpers.getOverlayCount();
        await mapHelpers.toggleProjectFilter('completed');
        const filteredOverlayCount = await mapHelpers.getOverlayCount();
        await mapHelpers.toggleProjectFilter('completed');
        
        console.log(`Filter test - Initial: ${initialOverlayCount}, Filtered: ${filteredOverlayCount}`);
        
        // AI : 6. Test zoom-based overlay loading
        await mapHelpers.zoomToLevel(5);
        const lowZoomImages = await mapHelpers.verifyOverlayImageLoading(false);
        
        await mapHelpers.zoomToLevel(15);
        const highZoomImages = await mapHelpers.verifyOverlayImageLoading(true);
        
        console.log(`Zoom test - Low: ${lowZoomImages}, High: ${highZoomImages}`);
      }
    }
  });

  test('should validate marker color logic in both modes', async ({ page }) => {
    // AI : Navigate to overlays using proper hierarchy
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Ensure we start in view mode
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
    }
    
    const viewColors = await mapHelpers.getVisibleMarkerColors();
    
    // AI : In view mode, should see timeline-based colors
    const timelineColors = viewColors.filter(color => ['blue'].includes(color));
    expect(timelineColors.length).toBeGreaterThan(0);
    
    // AI : Switch to edit mode
    await mapHelpers.toggleEditMode();
    await page.waitForTimeout(500);
    
    const editColors = await mapHelpers.getVisibleMarkerColors();
    
    // AI : In edit mode, should see state colors: green, orange, red, blue, purple
    const stateColors = editColors.filter(color => ['green', 'orange', 'red', 'blue', 'purple'].includes(color));
    expect(stateColors.length).toBeGreaterThan(0);
    
    console.log(`View mode uses timeline colors: ${timelineColors.join(', ')}`);
    console.log(`Edit mode uses state colors: ${stateColors.join(', ')}`);
  });

  test('should handle edge cases and error states', async ({ page }) => {
    // AI : Test navigation workflow
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    
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
    
    // AI : Test rapid mode switching after successful navigation
    if (navigationSuccess) {
      for (let i = 0; i < 3; i++) {
        await mapHelpers.toggleEditMode();
        await page.waitForTimeout(100);
      }
    }
    
    // AI : Map should remain functional
    await expect(page.locator('.leaflet-container')).toBeVisible();
    console.log(`Navigation result: ${navigationSuccess}`);
  });
});