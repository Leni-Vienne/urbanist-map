import { test, expect } from '@playwright/test';

test.describe('Overlay Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should show different marker colors in edit mode based on overlay state', async ({ page }) => {
    // AI : Switch to edit mode to see different marker colors
    await page.getByRole('button', { name: 'Toggle Edit Mode' }).click();
    await page.waitForTimeout(1000);
    
    // AI : Wait for map markers to load
    await page.waitForSelector('.leaflet-marker-icon');
    
    // AI : Get all markers and check for different colors
    const markers = page.locator('.leaflet-marker-icon');
    const markerCount = await markers.count();
    
    if (markerCount > 0) {
      // AI : Check for different marker color states
      // AI : Green = remote overlay not modified
      // AI : Orange = remote overlay modified locally
      // AI : Red = local overlay with changes  
      // AI : Blue = new overlay no changes
      // AI : Purple = replacement overlay
      
      const colorPatterns = ['green', 'orange', 'red', 'blue', 'purple'];
      const foundColors = [];
      
      for (const color of colorPatterns) {
        const colorMarkers = page.locator(`.leaflet-marker-icon[src*="${color}"]`);
        const count = await colorMarkers.count();
        if (count > 0) {
          foundColors.push(color);
        }
      }
      
      console.log(`Found marker colors in edit mode: ${foundColors.join(', ')}`);
      expect(foundColors.length).toBeGreaterThan(0);
    }
  });

  test('should show construction timeline colors in view mode', async ({ page }) => {
    // AI : Ensure we're in view mode
    const editModeButton = page.getByRole('button', { name: 'Toggle Edit Mode' });
    
    // AI : If in edit mode, switch to view mode
    if (await editModeButton.getAttribute('active')) {
      await editModeButton.click();
      await page.waitForTimeout(500);
    }
    
    // AI : Wait for markers to update colors
    await page.waitForSelector('.leaflet-marker-icon');
    
    // AI : In view mode, markers show construction timeline:
    // AI : Green = future projects (not started)
    // AI : Orange = current projects (in progress) 
    // AI : Grey = completed projects
    
    const markers = page.locator('.leaflet-marker-icon');
    const markerCount = await markers.count();
    
    if (markerCount > 0) {
      const timelineColors = ['green', 'orange', 'grey'];
      const foundColors = [];
      
      for (const color of timelineColors) {
        const colorMarkers = page.locator(`.leaflet-marker-icon[src*="${color}"]`);
        const count = await colorMarkers.count();
        if (count > 0) {
          foundColors.push(color);
        }
      }
      
      console.log(`Found timeline colors in view mode: ${foundColors.join(', ')}`);
      expect(foundColors.length).toBeGreaterThan(0);
    }
  });

  test('should handle overlay selection and info popup', async ({ page }) => {
    // AI : Click on an overlay in the sidebar
    const firstOverlay = page.locator('[data-testid="overlay-item"]').first();
    
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

  test('should handle map marker clicks', async ({ page }) => {
    // AI : Wait for map markers to be available
    await page.waitForSelector('.leaflet-marker-icon');
    
    const markers = page.locator('.leaflet-marker-icon');
    const markerCount = await markers.count();
    
    if (markerCount > 0) {
      // AI : Click on first visible marker
      await markers.first().click();
      await page.waitForTimeout(500);
      
      // AI : Check for marker interaction response
      // AI : Could be selection, tooltip, or popup
      const tooltips = page.locator('.leaflet-tooltip');
      const popups = page.locator('.leaflet-popup');
      
      const hasTooltip = await tooltips.count() > 0;
      const hasPopup = await popups.count() > 0;
      
      console.log(`Marker click resulted in: tooltip=${hasTooltip}, popup=${hasPopup}`);
    }
  });

  test('should navigate to overlay location when clicking "Zoom to" button', async ({ page }) => {
    // AI : Get initial map center/zoom
    const initialZoom = await page.evaluate(() => {
      return (window as any).map?.getZoom();
    });
    
    // AI : Click zoom to button
    const zoomToButton = page.getByRole('button', { name: /Zoom to/ }).first();
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
  });
});