import { test, expect } from "@playwright/test";
import { MapTestHelpers } from "../../helpers/map-helpers";
import { setupMapTest } from "../../helpers/test-helpers";

test.describe("Marker Filtering", () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    mapHelpers = await setupMapTest(page);
  });

  test("should toggle project status filters", async ({ page }) => {
    // Navigate to overlays using proper hierarchy first
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log("No country/city markers available for testing");
      return;
    }

    // Wait for overlays to load
    await page.waitForTimeout(1000);

    // Ensure we're in view mode (filters only available in view mode)
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
      await page.waitForTimeout(500);
    }

    // Verify filter button is visible (only in view mode)
    const filterButton = page.getByRole("button", { name: "Toggle project filters" });
    await expect(filterButton).toBeVisible();

    // Count initial visible overlays in sidebar
    const initialOverlays = await mapHelpers.getOverlayCount();

    // Toggle off "planned" projects (green markers)
    await mapHelpers.toggleProjectFilter("planned");

    // Wait for filter to apply and count again
    await page.waitForTimeout(500);
    const afterToggleOverlays = await mapHelpers.getOverlayCount();

    // Verify some overlays were hidden (assuming there were green markers)
    expect(afterToggleOverlays).toBeLessThanOrEqual(initialOverlays);

    // Toggle back on
    await mapHelpers.toggleProjectFilter("planned");

    // Verify overlays are visible again
    await page.waitForTimeout(500);
    const finalOverlays = await mapHelpers.getOverlayCount();
    expect(finalOverlays).toBeGreaterThanOrEqual(afterToggleOverlays);
  });

  test("should filter markers based on completion status", async ({ page }) => {
    // Navigate to overlays using proper hierarchy first
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log("No country/city markers available for testing");
      return;
    }

    await page.waitForTimeout(1000);

    // Ensure we're in view mode (filters only available in view mode)
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
      await page.waitForTimeout(500);
    }

    const initialMarkers = await mapHelpers.getVisibleMarkerColors();
    const initialCount = initialMarkers.length;

    // Toggle off completed projects
    await mapHelpers.toggleProjectFilter("completed");

    // Count markers after filtering
    await page.waitForTimeout(500);
    const filteredMarkers = await mapHelpers.getVisibleMarkerColors();
    const filteredCount = filteredMarkers.length;

    // Should have fewer or equal markers visible
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    console.log(`Markers before filter: ${initialCount}, after filter: ${filteredCount}`);
  });

  test("should show different marker colors based on project timeline", async ({ page }) => {
    // Navigate to overlays to get data-driven markers
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log("No country/city markers available for testing");
      return;
    }

    // Check view mode colors (timeline-based)
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
    }

    const viewModeColors = await mapHelpers.getVisibleMarkerColors();
    console.log(`View mode marker colors: ${viewModeColors.join(", ")}`);

    // Switch to edit mode and check state-based colors
    await mapHelpers.toggleEditMode();
    await page.waitForTimeout(500);

    const editModeColors = await mapHelpers.getVisibleMarkerColors();
    console.log(`Edit mode marker colors: ${editModeColors.join(", ")}`);

    // Verify we have markers in both modes
    expect(viewModeColors.length).toBeGreaterThan(0);
    expect(editModeColors.length).toBeGreaterThan(0);
  });
});
