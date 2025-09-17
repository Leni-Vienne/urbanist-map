import { test, expect } from '@playwright/test';
import { enableHelpModal, disableHelpModal } from './helpers/test-helpers';

test.describe('Application Setup', () => {
  test('should install Playwright browsers', async ({ page }) => {
    // AI : This test ensures browsers are installed
    await disableHelpModal(page); // Prevent modal interference
    await page.goto('/');
    await expect(page).toHaveTitle(/Construction Map/);
  });
  
  test('should display the help modal on first load', async ({ page }) => {
    // AI : Enable modal for this test specifically
    await enableHelpModal(page);
    await page.goto('/');
    await page.waitForTimeout(1500); // Wait for auto-show delay
    
    const helpModal = page.getByTestId('map-help-modal');
    await expect(helpModal).toBeVisible();
    
    // AI : Close using the correct button text (from i18n)
    const closeButton = helpModal.getByRole('button', { name: /j'ai compris|got it/i });
    await closeButton.click();
    await expect(helpModal).toBeHidden();
  });
  
  test('should open and close the help modal via the help button', async ({ page }) => {
    // AI : Disable auto-show for this test
    await disableHelpModal(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // AI : Manually open via help button
    const helpButton = page.getByRole('button', { name: 'Help' });
    await helpButton.click();
    await page.waitForTimeout(500);
    
    const helpModal = page.getByTestId('map-help-modal');
    await expect(helpModal).toBeVisible();
    
    // AI : Close using the correct button text
    const closeButton = helpModal.getByRole('button', { name: /j'ai compris|got it/i });
    await closeButton.click();
    await expect(helpModal).toBeHidden();
  });
});