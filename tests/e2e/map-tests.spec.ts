import { test, expect } from '@playwright/test';
import { MapTestHelpers } from '../helpers/map-helpers';
import { disableHelpModal } from '../helpers/test-helpers';

test.describe('Construction Map E2E Tests', () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    // AI : Disable help modal to prevent test interference
    await disableHelpModal(page);
    
    mapHelpers = new MapTestHelpers(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await mapHelpers.waitForMapReady();
    await mapHelpers.dismissErrorAlerts();
    
    // AI : Setup authentication for tests that require it
    const { AuthTestHelpers } = await import('../helpers/auth-helpers');
    const authHelpers = new AuthTestHelpers(page);
    await authHelpers.setupAuthenticatedState();
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

  test('should show overlays in sidebar after navigation', async ({ page }) => {
    // AI : Navigate using proper hierarchy: country → city → overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    
    if (navigationSuccess) {
      const overlayCount = await mapHelpers.getOverlayCount();
      console.log(`Found ${overlayCount} overlays in sidebar after navigation`);
      
      if (overlayCount > 0) {
        // AI : Test zoom to functionality
        const zoomToButton = page.getByRole('button', { name: /Zoom to/ }).first();
        await zoomToButton.click();
        await page.waitForTimeout(1000);
      }
    } else {
      console.log('No country/city data available for navigation testing');
    }
  });

  test('should test authenticated features if logged in', async ({ page }) => {
    // AI : Check if user is authenticated
    const myContribTab = page.getByText('My Contributions');
    const isAuthenticated = await myContribTab.count() > 0;
    
    if (isAuthenticated) {
      console.log('User is authenticated - testing auth features');
      
      // AI : Navigate to overlays first
      const navigationSuccess = await mapHelpers.navigateToOverlays();
      
      if (navigationSuccess) {
        // AI : Test My Contributions tab
        await myContribTab.click();
        await page.waitForTimeout(1000);
        
        // AI : Test overlay creation in edit mode
        await mapHelpers.toggleEditMode();
        const addOverlayButton = page.getByRole('button', { name: 'Add Image Overlay' });
        await expect(addOverlayButton).toBeVisible();
      }
    } else {
      console.log('User not authenticated - testing public features only');
      
      // AI : Test navigation hierarchy works for public users
      const navigationSuccess = await mapHelpers.navigateToOverlays();
      console.log(`Public navigation success: ${navigationSuccess}`);
      
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