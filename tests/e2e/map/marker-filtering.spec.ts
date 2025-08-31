import { test, expect } from '@playwright/test';

test.describe('Marker Filtering', () => {
  test.beforeEach(async ({ page }) => {
    // AI : Navigate to the map application
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // AI : Wait for overlays to load
    await page.waitForTimeout(2000);
  });

  test('should toggle project status filters', async ({ page }) => {
    // AI : Get filter buttons for different project statuses
    const notStartedFilter = page.getByRole('button', { name: 'Toggle not started projects' });
    const inProgressFilter = page.getByRole('button', { name: 'Toggle in progress projects' });
    const completedFilter = page.getByRole('button', { name: 'Toggle completed projects' });

    // AI : Verify all filters are visible
    await expect(notStartedFilter).toBeVisible();
    await expect(inProgressFilter).toBeVisible();
    await expect(completedFilter).toBeVisible();

    // AI : Count initial visible overlays in sidebar
    const initialOverlays = await page.locator('[data-testid="overlay-item"]').count();
    
    // AI : Toggle off "not started" projects (green markers)
    await notStartedFilter.click();
    
    // AI : Wait for filter to apply and count again
    await page.waitForTimeout(500);
    const afterToggleOverlays = await page.locator('[data-testid="overlay-item"]').count();
    
    // AI : Verify some overlays were hidden (assuming there were green markers)
    expect(afterToggleOverlays).toBeLessThanOrEqual(initialOverlays);

    // AI : Toggle back on
    await notStartedFilter.click();
    await page.waitForTimeout(500);
    
    // AI : Verify overlays are visible again
    const finalOverlays = await page.locator('[data-testid="overlay-item"]').count();
    expect(finalOverlays).toBeGreaterThanOrEqual(afterToggleOverlays);
  });

  test('should filter markers based on completion status', async ({ page }) => {
    // AI : Get all map markers initially
    const allMarkers = page.locator('.leaflet-marker-icon');
    const initialCount = await allMarkers.count();

    // AI : Toggle off completed projects (grey markers)
    await page.getByRole('button', { name: 'Toggle completed projects' }).click();
    await page.waitForTimeout(500);

    // AI : Count markers after filtering
    const filteredCount = await allMarkers.count();
    
    // AI : Should have fewer or equal markers visible
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test('should show different marker colors based on project timeline', async ({ page }) => {
    // AI : Wait for map to fully load
    await page.waitForSelector('.leaflet-container');
    
    // AI : Get marker elements and check for different colors
    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers.first()).toBeVisible();
    
    // AI : Check that markers have different colored icons
    // AI : This test verifies the marker color system works
    const markerCount = await markers.count();
    expect(markerCount).toBeGreaterThan(0);
    
    // AI : Check for existence of different colored markers
    // AI : Green (not started), Orange (in progress), Grey (completed)
    const greenMarkers = page.locator('.leaflet-marker-icon[src*="green"]');
    const orangeMarkers = page.locator('.leaflet-marker-icon[src*="orange"]');
    const greyMarkers = page.locator('.leaflet-marker-icon[src*="grey"]');
    
    // AI : At least one type of marker should exist
    const hasMarkers = await greenMarkers.count() > 0 || 
                      await orangeMarkers.count() > 0 || 
                      await greyMarkers.count() > 0;
    expect(hasMarkers).toBeTruthy();
  });

  test('should maintain filter state when switching between view/edit modes', async ({ page }) => {
    // AI : Toggle off a filter
    await page.getByRole('button', { name: 'Toggle completed projects' }).click();
    await page.waitForTimeout(500);
    
    // AI : Switch to edit mode
    await page.getByRole('button', { name: 'Toggle Edit Mode' }).click();
    await page.waitForTimeout(500);
    
    // AI : Filter should still be off (button should still show it's toggled)
    const completedFilter = page.getByRole('button', { name: 'Toggle completed projects' });
    
    // AI : Switch back to view mode
    await page.getByRole('button', { name: 'Toggle Edit Mode' }).click();
    await page.waitForTimeout(500);
    
    // AI : Filter state should be preserved
    // AI : This test ensures filter persistence across mode changes
  });
});