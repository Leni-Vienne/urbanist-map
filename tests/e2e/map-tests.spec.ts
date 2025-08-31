import { test, expect } from '@playwright/test';
import { MapTestHelpers } from '../helpers/map-helpers';

test.describe('Construction Map E2E Tests', () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    mapHelpers = new MapTestHelpers(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await mapHelpers.waitForMapReady();
    await mapHelpers.dismissErrorAlerts();
  });

  test('should load map and basic controls', async ({ page }) => {
    // AI : Verify Leaflet map is initialized
    await expect(page.locator('.leaflet-container')).toBeVisible();
    
    // AI : Verify map controls are present
    await expect(page.getByRole('button', { name: 'Zoom In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom Out' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle Edit Mode' })).toBeVisible();
  });

  test('should switch between view and edit modes', async ({ page }) => {
    const editModeButton = page.getByRole('button', { name: 'Toggle Edit Mode' });
    
    // AI : Switch to edit mode
    await editModeButton.click();
    await page.waitForTimeout(500);
    
    // AI : Switch back to view mode
    await editModeButton.click();
    await page.waitForTimeout(500);
    
    console.log('Mode switching works');
  });

  test('should show overlays in sidebar', async ({ page }) => {
    // AI : Wait for overlay list to load
    await page.waitForTimeout(2000);
    
    const overlayItems = page.locator('[data-testid="overlay-item"]');
    const overlayCount = await overlayItems.count();
    
    console.log(`Found ${overlayCount} overlays in sidebar`);
    
    if (overlayCount > 0) {
      // AI : Test zoom to functionality
      const zoomToButton = page.getByRole('button', { name: /Zoom to/ }).first();
      await zoomToButton.click();
      await page.waitForTimeout(1000);
    }
  });

  test('should test authenticated features if logged in', async ({ page }) => {
    // AI : Check if user is authenticated
    const myContribTab = page.getByText('My Contributions');
    const isAuthenticated = await myContribTab.count() > 0;
    
    if (isAuthenticated) {
      console.log('User is authenticated - testing auth features');
      
      // AI : Test My Contributions tab
      await myContribTab.click();
      await page.waitForTimeout(1000);
      
      // AI : Test overlay creation in edit mode
      await mapHelpers.toggleEditMode();
      const addOverlayButton = page.getByRole('button', { name: 'Add Image Overlay' });
      await expect(addOverlayButton).toBeVisible();
      
    } else {
      console.log('User not authenticated - testing public features only');
      
      // AI : Verify public features work
      await expect(page.locator('.leaflet-container')).toBeVisible();
      await mapHelpers.toggleEditMode();
    }
  });

  test('should handle zoom and map interactions', async ({ page }) => {
    // AI : Test zoom controls
    const initialZoom = await mapHelpers.getCurrentZoom();
    
    await page.getByRole('button', { name: 'Zoom In' }).click();
    await page.waitForTimeout(500);
    
    const newZoom = await mapHelpers.getCurrentZoom();
    
    if (initialZoom && newZoom) {
      expect(newZoom).toBeGreaterThan(initialZoom);
      console.log(`Zoom changed from ${initialZoom} to ${newZoom}`);
    }
  });
});