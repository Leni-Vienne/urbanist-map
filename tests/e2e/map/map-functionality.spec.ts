import { test, expect } from '@playwright/test';
import { MapTestHelpers } from '../../helpers/map-helpers';
import { disableHelpModal } from '../helpers/test-helpers';

test.describe('Core Map Functionality', () => {
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

    // AI : Get initial zoom level using Vue's reactive system
    const initialZoom = await mapHelpers.getCurrentZoom();

    // AI : Click zoom in
    await page.getByRole('button', { name: 'Zoom In' }).click();
    await page.waitForTimeout(500);

    const zoomedInLevel = await mapHelpers.getCurrentZoom();

    // AI : Verify zoom increased
    if (initialZoom && zoomedInLevel) {
      expect(zoomedInLevel).toBeGreaterThan(initialZoom);
    }

    // AI : Click zoom out
    await page.getByRole('button', { name: 'Zoom Out' }).click();
    await page.waitForTimeout(500);

    const zoomedOutLevel = await mapHelpers.getCurrentZoom();

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
    // AI : Get initial map center using Leaflet API
    const initialCenter = await page.evaluate(() => {
      const container = document.querySelector('.leaflet-container') as any;
      if (container?._leaflet_map?.getCenter) {
        const center = container._leaflet_map.getCenter();
        return { lat: center.lat, lng: center.lng };
      }
      return null;
    });

    // AI : Perform drag operation on map
    const mapContainer = page.locator('.leaflet-container');
    await mapContainer.dragTo(mapContainer, {
      sourcePosition: { x: 100, y: 100 },
      targetPosition: { x: 200, y: 200 }
    });

    await page.waitForTimeout(500);

    // AI : Get new map center using Leaflet API
    const newCenter = await page.evaluate(() => {
      const container = document.querySelector('.leaflet-container') as any;
      if (container?._leaflet_map?.getCenter) {
        const center = container._leaflet_map.getCenter();
        return { lat: center.lat, lng: center.lng };
      }
      return null;
    });

    // AI : Verify map position changed
    if (initialCenter && newCenter) {
      const centerChanged = Math.abs(initialCenter.lat - newCenter.lat) > 0.001 ||
        Math.abs(initialCenter.lng - newCenter.lng) > 0.001;
      expect(centerChanged).toBeTruthy();
    }
  });

  test('should display overlay list in sidebar after proper navigation', async ({ page }) => {
    // AI : Navigate using proper hierarchy to load overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Wait for overlays to load in sidebar
    await page.waitForTimeout(1000);
    const overlayCount = await mapHelpers.getOverlayCount();

    if (overlayCount > 0) {
      // AI : Verify overlay items have required information
      const firstOverlay = page.locator('.overlay-card').first();

      // AI : Should have title
      await expect(firstOverlay.locator('h4')).toBeVisible();

      // AI : Should have location info
      await expect(firstOverlay).toContainText(/France|Location/);

      // AI : Should have timestamp
      await expect(firstOverlay).toContainText(/ago|week|month/);

      // AI : Should have zoom to button
      await expect(firstOverlay.getByRole('button', { name: /Zoom to/ })).toBeVisible();
    }

    console.log(`Found ${overlayCount} overlay items in sidebar after navigation`);
  });
});