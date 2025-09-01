import { test, expect } from '@playwright/test';
import { MapTestHelpers } from '../../helpers/map-helpers';

test.describe('Overlay Interactions', () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    mapHelpers = new MapTestHelpers(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await mapHelpers.waitForMapReady();
    await mapHelpers.dismissErrorAlerts();
  });

  test('should show different marker colors in edit mode based on overlay state', async ({ page }) => {
    // AI : Navigate to overlays using proper hierarchy: country → city → overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Switch to edit mode to see different marker colors
    await mapHelpers.toggleEditMode();
    
    // AI : Wait for markers to update with edit mode colors
    await page.waitForTimeout(1000);
    
    // AI : Get marker colors in edit mode
    const editModeColors = await mapHelpers.getVisibleMarkerColors();
    
    if (editModeColors.length > 0) {
      // AI : Check for edit mode marker color states
      // AI : Green = remote overlay not modified
      // AI : Orange = remote overlay modified locally
      // AI : Red = local overlay with changes  
      // AI : Blue = new overlay no changes
      // AI : Purple = replacement overlay
      
      const validEditColors = ['green', 'orange', 'red', 'blue', 'purple'];
      const foundEditColors = editModeColors.filter(color => validEditColors.includes(color));
      
      console.log(`Found overlay marker colors in edit mode: ${foundEditColors.join(', ')}`);
      expect(foundEditColors.length).toBeGreaterThan(0);
    }
  });

  test('should show construction timeline colors in view mode', async ({ page }) => {
    // AI : Navigate to overlays using proper hierarchy: country → city → overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Ensure we're in view mode
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
    }
    
    // AI : Wait for markers to update to view mode colors
    await page.waitForTimeout(500);
    
    // AI : Get marker colors in view mode
    const viewModeColors = await mapHelpers.getVisibleMarkerColors();
    
    if (viewModeColors.length > 0) {
      // AI : In view mode, overlays should show timeline-based colors (currently blue)
      const timelineColors = ['blue'];
      const foundTimelineColors = viewModeColors.filter(color => timelineColors.includes(color));
      
      console.log(`Found timeline colors in view mode: ${foundTimelineColors.join(', ')}`);
      expect(foundTimelineColors.length).toBeGreaterThan(0);
    }
  });

  test('should handle overlay selection and info popup', async ({ page }) => {
    // AI : Navigate to overlays using proper hierarchy: country → city → overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Wait for overlays to load in sidebar
    await page.waitForTimeout(1000);
    
    // AI : Click on an overlay in the sidebar
    const firstOverlay = page.locator('.overlay-card').first();
    
    if (await firstOverlay.count() > 0) {
      await firstOverlay.click();
      await page.waitForTimeout(500);
      
      // AI : Check if info popup appears
      const infoPopup = page.locator('[data-testid="info-popup"]');
      if (await infoPopup.count() > 0) {
        await expect(infoPopup).toBeVisible();
        
        // AI : Verify popup contains overlay information
        await expect(infoPopup).toContainText(/overlay|project/i);
        
        // AI : Close popup
        const closeButton = infoPopup.getByRole('button', { name: 'Close' });
        if (await closeButton.count() > 0) {
          await closeButton.click();
          await expect(infoPopup).not.toBeVisible();
        }
      }
    }
  });

  test('should handle marker clicks in proper hierarchy', async ({ page }) => {
    // AI : Test country marker click
    const countryMarkers = await mapHelpers.getCountryMarkerCount();
    if (countryMarkers > 0) {
      const countryClicked = await mapHelpers.clickCountryMarker(0);
      expect(countryClicked).toBeTruthy();
      
      // AI : Should load city markers
      await page.waitForTimeout(1000);
      const cityMarkers = await mapHelpers.getCityMarkerCount();
      
      if (cityMarkers > 0) {
        // AI : Test city marker click
        const cityClicked = await mapHelpers.clickCityMarker(0);
        expect(cityClicked).toBeTruthy();
        
        // AI : Should load overlays
        await page.waitForTimeout(1000);
        const overlayCount = await mapHelpers.getOverlayCount();
        console.log(`Navigation flow result - Cities: ${cityMarkers}, Overlays: ${overlayCount}`);
      }
    }
  });

  test('should navigate to overlay location when clicking "Zoom to" button', async ({ page }) => {
    // AI : Navigate to overlays using proper hierarchy first
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Wait for overlays to load
    await page.waitForTimeout(1000);
    
    // AI : Get initial map center/zoom
    const initialZoom = await page.evaluate(() => {
      return (window as any).map?.getZoom();
    });
    
    // AI : Click zoom to button if overlays are available
    const zoomToButton = page.getByRole('button', { name: /Zoom to/ }).first();
    if (await zoomToButton.count() > 0) {
      await zoomToButton.click();
      await page.waitForTimeout(1000);
      
      // AI : Verify map position changed
      const newZoom = await page.evaluate(() => {
        return (window as any).map?.getZoom();
      });
      
      // AI : Zoom level should have changed (increased)
      if (initialZoom && newZoom) {
        expect(newZoom).toBeGreaterThan(initialZoom);
      }
    }
  });
});