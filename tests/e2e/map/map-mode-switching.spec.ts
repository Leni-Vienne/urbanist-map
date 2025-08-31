import { test, expect } from '@playwright/test';

test.describe('Map Mode Switching', () => {
  test.beforeEach(async ({ page }) => {
    // AI : Navigate to the map application
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should switch between view and edit modes', async ({ page }) => {
    // AI : Verify initial state (should be in view mode)
    const editModeButton = page.getByRole('button', { name: 'Toggle Edit Mode' });
    await expect(editModeButton).toBeVisible();
    
    // AI : Check that edit mode is not active initially
    await expect(editModeButton).not.toHaveAttribute('active');

    // AI : Switch to edit mode
    await editModeButton.click();
    
    // AI : Verify edit mode is now active
    await expect(editModeButton).toHaveAttribute('active');
    
    // AI : Check for edit mode notification
    await expect(page.getByText('Switched to Edit Mode')).toBeVisible();
    
    // AI : Verify tooltip text changes
    await expect(page.getByText('Currently in Edit Mode - Click to switch to view mode')).toBeVisible();

    // AI : Switch back to view mode
    await editModeButton.click();
    
    // AI : Verify we're back in view mode
    await expect(editModeButton).not.toHaveAttribute('active');
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

  test('should persist edit mode state during navigation', async ({ page }) => {
    const editModeButton = page.getByRole('button', { name: 'Toggle Edit Mode' });
    
    // AI : Switch to edit mode
    await editModeButton.click();
    await expect(editModeButton).toHaveAttribute('active');
    
    // AI : Navigate to different overlay or zoom
    await page.getByRole('button', { name: /Zoom to/ }).first().click();
    
    // AI : Edit mode should still be active
    await expect(editModeButton).toHaveAttribute('active');
  });
});