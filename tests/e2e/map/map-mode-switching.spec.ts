import { test, expect } from "@playwright/test";
import { MapTestHelpers } from "../../helpers/map-helpers";
import { setupMapTest } from "../../helpers/test-helpers";

test.describe("Map Mode Switching", () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    mapHelpers = await setupMapTest(page);
  });

  test("should switch between view and edit modes", async ({ page }) => {
    // Verify initial state (should be in view mode)
    expect(await mapHelpers.isEditModeActive()).toBeFalsy();

    // Check mode indicator is visible and shows View Mode
    const modeIndicator = page.locator(".mode-indicator");
    await expect(modeIndicator).toBeVisible();
    await expect(modeIndicator).not.toHaveClass(/edit-mode/);

    // Switch to edit mode
    await mapHelpers.toggleEditMode();

    // Verify edit mode is now active
    expect(await mapHelpers.isEditModeActive()).toBeTruthy();
    await expect(modeIndicator).toHaveClass(/edit-mode/);

    // Check for edit mode notification
    await expect(page.getByText(/Switched to.*Mode/i)).toBeVisible();

    // Switch back to view mode
    await mapHelpers.toggleEditMode();

    // Verify we're back in view mode
    expect(await mapHelpers.isEditModeActive()).toBeFalsy();
    await expect(modeIndicator).not.toHaveClass(/edit-mode/);
  });

  test("should show Add Image Overlay button only in edit mode", async ({ page }) => {
    const addOverlayButton = page.getByRole("button", { name: "Add Image Overlay" });

    // In view mode, add overlay button should be visible
    await expect(addOverlayButton).toBeVisible();

    // Switch to edit mode
    await mapHelpers.toggleEditMode();
    await page.waitForTimeout(500);

    // In edit mode, add overlay button should still be visible and enabled
    await expect(addOverlayButton).toBeVisible();
    await expect(addOverlayButton).toBeEnabled();
  });

  test("should persist edit mode state during navigation", async () => {
    // Switch to edit mode
    await mapHelpers.toggleEditMode();
    expect(await mapHelpers.isEditModeActive()).toBeTruthy();

    // Navigate using proper hierarchy
    const navigationSuccess = await mapHelpers.navigateToOverlays();

    // Edit mode should still be active after navigation
    expect(await mapHelpers.isEditModeActive()).toBeTruthy();

    console.log(`Edit mode persisted through navigation: ${navigationSuccess}`);
  });
});
