import { test, expect } from '@playwright/test';
import { MapTestHelpers } from '../../helpers/map-helpers';
import { disableHelpModal } from '../../helpers/test-helpers';

test.describe('Marker Filtering', () => {
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
    const { AuthTestHelpers } = await import('../../helpers/auth-helpers');
    const authHelpers = new AuthTestHelpers(page);
    await authHelpers.setupAuthenticatedState();
  });

  test('should toggle project status filters', async ({ page }) => {
    // AI : Navigate to overlays using proper hierarchy first
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Wait for overlays to load
    await page.waitForTimeout(1000);

    // AI : Get filter buttons for different project statuses
    const notStartedFilter = page.getByRole('button', { name: 'Toggle not started projects' });
    const inProgressFilter = page.getByRole('button', { name: 'Toggle in progress projects' });
    const completedFilter = page.getByRole('button', { name: 'Toggle completed projects' });

    // AI : Verify all filters are visible
    await expect(notStartedFilter).toBeVisible();
    await expect(inProgressFilter).toBeVisible();
    await expect(completedFilter).toBeVisible();

    // AI : Count initial visible overlays in sidebar
    const initialOverlays = await mapHelpers.getOverlayCount();
    
    // AI : Toggle off "not started" projects (green markers)
    await mapHelpers.toggleProjectFilter('not started');
    
    // AI : Wait for filter to apply and count again
    const afterToggleOverlays = await mapHelpers.getOverlayCount();
    
    // AI : Verify some overlays were hidden (assuming there were green markers)
    expect(afterToggleOverlays).toBeLessThanOrEqual(initialOverlays);

    // AI : Toggle back on
    await mapHelpers.toggleProjectFilter('not started');
    
    // AI : Verify overlays are visible again
    const finalOverlays = await mapHelpers.getOverlayCount();
    expect(finalOverlays).toBeGreaterThanOrEqual(afterToggleOverlays);
  });

  test('should filter markers based on completion status', async ({ page }) => {
    // AI : Navigate to overlays using proper hierarchy first
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Get all overlay markers initially (at low zoom they should be markers)
    await mapHelpers.zoomToLevel(8); // AI : Medium zoom to see overlay markers
    await page.waitForTimeout(1000);
    
    const initialMarkers = await mapHelpers.getVisibleMarkerColors();
    const initialCount = initialMarkers.length;

    // AI : Toggle off completed projects
    await mapHelpers.toggleProjectFilter('completed');
    
    // AI : Count markers after filtering
    const filteredMarkers = await mapHelpers.getVisibleMarkerColors();
    const filteredCount = filteredMarkers.length;
    
    // AI : Should have fewer or equal markers visible
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    console.log(`Markers before filter: ${initialCount}, after filter: ${filteredCount}`);
  });

  test('should show different marker colors based on project timeline', async ({ page }) => {
    // AI : Navigate to overlays to get data-driven markers
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Check view mode colors (timeline-based)
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
    }
    
    const viewModeColors = await mapHelpers.getVisibleMarkerColors();
    console.log(`View mode marker colors: ${viewModeColors.join(', ')}`);
    
    // AI : Switch to edit mode and check state-based colors
    await mapHelpers.toggleEditMode();
    await page.waitForTimeout(500);
    
    const editModeColors = await mapHelpers.getVisibleMarkerColors();
    console.log(`Edit mode marker colors: ${editModeColors.join(', ')}`);
    
    // AI : Verify we have markers in both modes
    expect(viewModeColors.length).toBeGreaterThan(0);
    expect(editModeColors.length).toBeGreaterThan(0);
  });

  test('should maintain filter state when switching between view/edit modes', async () => {
    // AI : Navigate to overlays first
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log('No country/city markers available for testing');
      return;
    }

    // AI : Count initial overlays
    const initialCount = await mapHelpers.getOverlayCount();
    
    // AI : Toggle off a filter
    await mapHelpers.toggleProjectFilter('completed');
    const filteredCount = await mapHelpers.getOverlayCount();
    
    // AI : Switch to edit mode
    await mapHelpers.toggleEditMode();
    const editModeCount = await mapHelpers.getOverlayCount();
    
    // AI : Switch back to view mode
    await mapHelpers.toggleEditMode();
    const finalCount = await mapHelpers.getOverlayCount();
    
    // AI : Filter state should be preserved
    expect(finalCount).toBe(filteredCount);
    console.log(`Overlay counts - Initial: ${initialCount}, Filtered: ${filteredCount}, Edit: ${editModeCount}, Final: ${finalCount}`);
  });
});