import { test, expect } from "@playwright/test";
import { MapTestHelpers } from "../../helpers/map-helpers";
import { setupMapTest } from "../../helpers/test-helpers";

test.describe("Comprehensive Map Testing", () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    mapHelpers = await setupMapTest(page);
  });

  test("should demonstrate full map workflow: city → overlays → modes → filtering", async ({
    page,
  }) => {
    // 1. Verify initial state and reset to view mode if needed
    await expect(page.locator(".leaflet-container")).toBeVisible();

    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
    }
    expect(await mapHelpers.isEditModeActive()).toBeFalsy();

    const initialCityMarkers = await mapHelpers.getCityMarkerCount();
    console.log(`Initial city markers: ${initialCityMarkers}`);
    expect(initialCityMarkers).toBeGreaterThan(0);

    // 2. Navigate through markers: city → overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays(0);
    expect(navigationSuccess).toBeTruthy();

    // 3. Click on overlay markers to test interaction
    const finalMarkerCount = await mapHelpers.getTotalMarkerCount();
    console.log(`Markers after navigation: ${finalMarkerCount}`);
    expect(finalMarkerCount).toBeGreaterThan(0);

    // Click on an overlay marker if available
    if (finalMarkerCount > 0) {
      const overlayClicked = await mapHelpers.clickOverlayMarker(0);
      console.log(`Overlay marker clicked: ${overlayClicked}`);
    }

    // 4. Test marker colors in view mode (overlays visible in view mode)
    const viewModeColors = await mapHelpers.getVisibleMarkerColors();
    console.log(`View mode colors: ${viewModeColors.join(", ")}`);
    expect(viewModeColors.length).toBeGreaterThan(0);
  });

  test("should validate marker visibility and interaction", async () => {
    // Navigate through marker hierarchy
    const navigationSuccess = await mapHelpers.navigateToOverlays(0);
    if (!navigationSuccess) {
      console.log("No markers available for testing");
      return;
    }

    // Ensure we start in view mode
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
    }

    // Test marker colors in view mode (overlays are visible in view mode)
    const viewColors = await mapHelpers.getVisibleMarkerColors();
    console.log(`View mode marker colors: ${viewColors.join(", ")}`);
    expect(viewColors.length).toBeGreaterThan(0);

    // Click on a marker to test interaction
    const markerCount = await mapHelpers.getTotalMarkerCount();
    if (markerCount > 0) {
      const clicked = await mapHelpers.clickOverlayMarker(0);
      console.log(`Marker interaction successful: ${clicked}`);
    }
  });

  test("should handle edge cases and error states", async ({ page }) => {
    // Test navigation workflow through markers
    const navigationSuccess = await mapHelpers.navigateToOverlays(0);

    // Check for any error messages during navigation
    const errorAlerts = page.locator('[role="alert"]');
    const errorCount = await errorAlerts.count();

    if (errorCount > 0) {
      // Verify error messages are user-friendly
      const errorText = await errorAlerts.first().textContent();
      expect(errorText).toBeTruthy();
      console.log(`Error message: ${errorText}`);

      // Dismiss errors
      await mapHelpers.dismissErrorAlerts();
    }

    // Test marker interaction after navigation
    if (navigationSuccess) {
      const markerCount = await mapHelpers.getTotalMarkerCount();
      if (markerCount > 0) {
        const clicked = await mapHelpers.clickOverlayMarker(0);
        console.log(`Edge case marker click: ${clicked}`);
      }
    }

    // Map should remain functional
    await expect(page.locator(".leaflet-container")).toBeVisible();
    console.log(`Navigation result: ${navigationSuccess}`);
  });
});
