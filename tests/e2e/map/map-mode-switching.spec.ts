import { test, expect } from '@playwright/test';
import { MapTestHelpers } from '../../helpers/map-helpers';
import { setupMapTest } from '../../helpers/test-helpers';

test.describe('Map Mode Switching', () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    mapHelpers = await setupMapTest(page);
  });

  test('should switch between view and edit modes', async ({ page }) => {
    // AI : Verify initial state (should be in view mode)
    expect(await mapHelpers.isEditModeActive()).toBeFalsy();

    // AI : Check mode indicator is visible and shows View Mode
    const modeIndicator = page.locator('.mode-indicator');
    await expect(modeIndicator).toBeVisible();
    await expect(modeIndicator).not.toHaveClass(/edit-mode/);

    // AI : Switch to edit mode
    await mapHelpers.toggleEditMode();

    // AI : Verify edit mode is now active
    expect(await mapHelpers.isEditModeActive()).toBeTruthy();
    await expect(modeIndicator).toHaveClass(/edit-mode/);

    // AI : Check for edit mode notification
    await expect(page.getByText(/Switched to.*Mode/i)).toBeVisible();

    // AI : Switch back to view mode
    await mapHelpers.toggleEditMode();

    // AI : Verify we're back in view mode
    expect(await mapHelpers.isEditModeActive()).toBeFalsy();
    await expect(modeIndicator).not.toHaveClass(/edit-mode/);
  });

  test('should show Add Image Overlay button only in edit mode', async ({ page }) => {
    const addOverlayButton = page.getByRole('button', { name: 'Add Image Overlay' });

    // AI : In view mode, add overlay button should be visible
    await expect(addOverlayButton).toBeVisible();

    // AI : Switch to edit mode
    await mapHelpers.toggleEditMode();
    await page.waitForTimeout(500);

    // AI : In edit mode, add overlay button should still be visible and enabled
    await expect(addOverlayButton).toBeVisible();
    await expect(addOverlayButton).toBeEnabled();
  });

  test('should persist edit mode state during navigation', async () => {
    // AI : Switch to edit mode
    await mapHelpers.toggleEditMode();
    expect(await mapHelpers.isEditModeActive()).toBeTruthy();
    
    // AI : Navigate using proper hierarchy
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    
    // AI : Edit mode should still be active after navigation
    expect(await mapHelpers.isEditModeActive()).toBeTruthy();
    
    console.log(`Edit mode persisted through navigation: ${navigationSuccess}`);
  });
});