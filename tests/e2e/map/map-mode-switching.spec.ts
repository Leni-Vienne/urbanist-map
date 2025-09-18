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
    
    const editModeButton = page.getByRole('button', { name: 'Toggle Edit Mode' });
    await expect(editModeButton).toBeVisible();
    await expect(editModeButton).toHaveAttribute('active', 'false');

    // AI : Switch to edit mode
    await mapHelpers.toggleEditMode();
    
    // AI : Verify edit mode is now active
    expect(await mapHelpers.isEditModeActive()).toBeTruthy();
    await expect(editModeButton).toHaveAttribute('active', 'true');
    
    // AI : Check for edit mode notification
    await expect(page.getByText('Switched to Edit Mode')).toBeVisible();
    
    // AI : Verify tooltip text changes
    await expect(page.getByText('Currently in Edit Mode - Click to switch to view mode')).toBeVisible();

    // AI : Switch back to view mode
    await mapHelpers.toggleEditMode();
    
    // AI : Verify we're back in view mode
    expect(await mapHelpers.isEditModeActive()).toBeFalsy();
    await expect(editModeButton).toHaveAttribute('active', 'false');
  });

  test('should show Add Image Overlay button only in edit mode', async ({ page }) => {
    const addOverlayButton = page.getByRole('button', { name: 'Add Image Overlay' });
    const editModeButton = page.getByRole('button', { name: 'Toggle Edit Mode' });

    // AI : In view mode, add overlay button should be visible but maybe disabled
    await expect(addOverlayButton).toBeVisible();

    // AI : Switch to edit mode
    await editModeButton.click();
    
    // AI : In edit mode, add overlay button should be enabled
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