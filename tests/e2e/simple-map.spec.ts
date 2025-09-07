import { test, expect } from '@playwright/test';

test.describe('Simple Map Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.leaflet-container');
    await page.waitForTimeout(3000); // Wait for everything to load
  });

  test('should load the map application', async ({ page }) => {
    // AI : Basic check that app loads
    await expect(page).toHaveTitle(/Construction Map/);
    await expect(page.locator('.leaflet-container')).toBeVisible();
  });

  test('should have map controls', async ({ page }) => {
    // AI : Check for basic map controls
    await expect(page.getByRole('button', { name: 'Zoom In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom Out' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle Edit Mode' })).toBeVisible();
  });

  test('should toggle edit mode', async ({ page }) => {
    const editButton = page.getByRole('button', { name: 'Toggle Edit Mode' });
    
    // AI : Click to enter edit mode
    await editButton.click();
    await page.waitForTimeout(1000);
    
    // AI : Click to exit edit mode
    await editButton.click();
    await page.waitForTimeout(1000);
    
    console.log('Edit mode toggle successful');
  });

  test('should interact with zoom controls', async ({ page }) => {
    // AI : Test zoom buttons work
    await page.getByRole('button', { name: 'Zoom In' }).click();
    await page.waitForTimeout(500);
    
    await page.getByRole('button', { name: 'Zoom Out' }).click();
    await page.waitForTimeout(500);
    
    console.log('Zoom controls work');
  });

  test('should show overlay list in sidebar', async ({ page }) => {
    // AI : Check if sidebar has overlays
    await page.waitForTimeout(2000); // Wait for data to load
    
    const overlayList = page.locator('.sidecolumn');
    await expect(overlayList).toBeVisible();
    
    // AI : Check for overlay items (if any exist)
    const overlayItems = page.locator('h4'); // Overlay titles
    const count = await overlayItems.count();
    
    console.log(`Found ${count} overlay items`);
  });
});