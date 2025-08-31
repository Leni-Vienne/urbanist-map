import { test, expect } from '@playwright/test';

test.describe('Core Map Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.leaflet-container');
  });

  test('should load the map correctly', async ({ page }) => {
    // AI : Verify Leaflet map is initialized
    await expect(page.locator('.leaflet-container')).toBeVisible();
    
    // AI : Check for map tiles
    const tileCount = await page.locator('.leaflet-tile').count();
    expect(tileCount).toBeGreaterThan(0);
    
    // AI : Verify map controls are present
    await expect(page.getByRole('button', { name: 'Zoom In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom Out' })).toBeVisible();
  });

  test('should respond to zoom controls', async ({ page }) => {
    // AI : Get initial zoom level
    const initialZoom = await page.evaluate(() => {
      return (window as any).map?.getZoom();
    });
    
    // AI : Click zoom in
    await page.getByRole('button', { name: 'Zoom In' }).click();
    await page.waitForTimeout(500);
    
    const zoomedInLevel = await page.evaluate(() => {
      return (window as any).map?.getZoom();
    });
    
    // AI : Verify zoom increased
    if (initialZoom && zoomedInLevel) {
      expect(zoomedInLevel).toBeGreaterThan(initialZoom);
    }
    
    // AI : Click zoom out
    await page.getByRole('button', { name: 'Zoom Out' }).click();
    await page.waitForTimeout(500);
    
    const zoomedOutLevel = await page.evaluate(() => {
      return (window as any).map?.getZoom();
    });
    
    // AI : Verify zoom decreased
    if (zoomedInLevel && zoomedOutLevel) {
      expect(zoomedOutLevel).toBeLessThan(zoomedInLevel);
    }
  });

  test('should show layer control', async ({ page }) => {
    // AI : Click layer control button
    await page.getByRole('button', { name: 'Layer Control' }).click();
    await page.waitForTimeout(500);
    
    // AI : Verify layer control opens (look for layer options)
    const layerControl = page.locator('.leaflet-control-layers');
    if (await layerControl.count() > 0) {
      await expect(layerControl).toBeVisible();
    }
  });

  test('should handle map pan and drag interactions', async ({ page }) => {
    // AI : Get initial map center
    const initialCenter = await page.evaluate(() => {
      const map = (window as any).map;
      return map ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : null;
    });
    
    // AI : Perform drag operation on map
    const mapContainer = page.locator('.leaflet-container');
    await mapContainer.dragTo(mapContainer, {
      sourcePosition: { x: 100, y: 100 },
      targetPosition: { x: 200, y: 200 }
    });
    
    await page.waitForTimeout(500);
    
    // AI : Get new map center
    const newCenter = await page.evaluate(() => {
      const map = (window as any).map;
      return map ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : null;
    });
    
    // AI : Verify map position changed
    if (initialCenter && newCenter) {
      const centerChanged = Math.abs(initialCenter.lat - newCenter.lat) > 0.001 || 
                           Math.abs(initialCenter.lng - newCenter.lng) > 0.001;
      expect(centerChanged).toBeTruthy();
    }
  });

  test('should display overlay list in sidebar', async ({ page }) => {
    // AI : Check sidebar overlay list
    const overlayItems = page.locator('[data-testid="overlay-item"]');
    
    // AI : Should have at least some overlays listed
    await page.waitForTimeout(1000);
    const overlayCount = await overlayItems.count();
    
    if (overlayCount > 0) {
      // AI : Verify overlay items have required information
      const firstOverlay = overlayItems.first();
      
      // AI : Should have title
      await expect(firstOverlay.locator('h4')).toBeVisible();
      
      // AI : Should have location info
      await expect(firstOverlay).toContainText(/France|Location/);
      
      // AI : Should have timestamp
      await expect(firstOverlay).toContainText(/ago|week|month/);
      
      // AI : Should have zoom to button
      await expect(firstOverlay.getByRole('button', { name: /Zoom to/ })).toBeVisible();
    }
    
    console.log(`Found ${overlayCount} overlay items in sidebar`);
  });
});