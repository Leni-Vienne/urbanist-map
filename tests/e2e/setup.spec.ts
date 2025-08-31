import { test, expect } from '@playwright/test';

test.describe('Application Setup', () => {
  test('should install Playwright browsers', async ({ page }) => {
    // AI : This test ensures browsers are installed
    await page.goto('/');
    await expect(page).toHaveTitle(/Construction Map/);
  });
});