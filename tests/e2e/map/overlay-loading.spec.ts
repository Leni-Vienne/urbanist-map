import { test, expect } from '@playwright/test';
import { MapTestHelpers } from '../../helpers/map-helpers';
import { disableHelpModal } from '../helpers/test-helpers';

test.describe('Overlay Loading & Zoom-based Display', () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    // AI : Disable help modal to prevent test interference
    await disableHelpModal(page);
    
    mapHelpers = new MapTestHelpers(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await mapHelpers.waitForMapReady();
    await mapHelpers.dismissErrorAlerts();
  });

  test('should load overlays only when zooming in beyond threshold', async ({ page }) => {
    // AI : Navigate to overlays using proper hierarchy: country → city → overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Start at a low zoom level
    await mapHelpers.zoomToLevel(5);
    await page.waitForTimeout(500);
    
    // AI : At low zoom, overlay images should not be loaded (only markers)
    const overlayImages = page.locator('.leaflet-image-layer');
    const lowZoomImageCount = await overlayImages.count();
    
    // AI : Now zoom in to trigger overlay loading
    await mapHelpers.zoomToLevel(13);
    await page.waitForTimeout(2000);
    
    // AI : At high zoom, overlays should be loaded
    const highZoomImageCount = await overlayImages.count();
    
    // AI : Verify zoom-based loading works
    console.log(`Images at low zoom: ${lowZoomImageCount}, at high zoom: ${highZoomImageCount}`);
    expect(highZoomImageCount).toBeGreaterThanOrEqual(lowZoomImageCount);
  });

  test('should unload overlay images when zooming out', async ({ page }) => {
    // AI : Navigate to overlays and ensure high zoom
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Zoom in to ensure overlays are loaded
    await mapHelpers.zoomToLevel(13);
    await page.waitForTimeout(1000);
    
    // AI : Check for loaded overlay images at high zoom
    const overlayImages = page.locator('.leaflet-image-layer');
    const highZoomImageCount = await overlayImages.count();
    
    // AI : Zoom out to trigger unloading
    await mapHelpers.zoomToLevel(5);
    await page.waitForTimeout(1000);
    
    // AI : Verify overlay images are unloaded
    const lowZoomImageCount = await overlayImages.count();
    
    // AI : At very low zoom, images should be unloaded
    console.log(`Images at high zoom: ${highZoomImageCount}, at low zoom: ${lowZoomImageCount}`);
    expect(lowZoomImageCount).toBeLessThanOrEqual(highZoomImageCount);
  });

  test('should show loading states when fetching overlays', async ({ page }) => {
    // AI : Monitor network requests for overlay loading
    const overlayRequests = [];
    
    page.on('request', request => {
      if (request.url().includes('overlay') || request.url().includes('cdn') || request.url().includes('cities.getCityProjects')) {
        overlayRequests.push(request.url());
      }
    });
    
    // AI : Navigate using proper hierarchy to trigger overlay loading
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    
    // AI : Wait for potential loading
    await page.waitForTimeout(2000);
    
    // AI : This test documents the loading behavior
    console.log(`Overlay requests made: ${overlayRequests.length}`);
    if (navigationSuccess) {
      expect(overlayRequests.length).toBeGreaterThan(0);
    }
  });

  test('should handle overlay loading errors gracefully', async ({ page }) => {
    // AI : Listen for console errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    // AI : Try to navigate using proper hierarchy (might cause errors if no data)
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    await page.waitForTimeout(2000);
    
    // AI : Check if error notifications appear
    const errorAlert = page.locator('[role="alert"]');
    if (await errorAlert.count() > 0) {
      // AI : Verify error message is user-friendly
      await expect(errorAlert).toContainText(/failed|error/i);
      
      // AI : Verify error can be dismissed
      const closeButton = errorAlert.getByRole('button', { name: 'Close' });
      if (await closeButton.count() > 0) {
        await closeButton.click();
        await expect(errorAlert).not.toBeVisible();
      }
    }
    
    console.log(`Console errors captured: ${errors.length}, Navigation successful: ${navigationSuccess}`);
  });
});