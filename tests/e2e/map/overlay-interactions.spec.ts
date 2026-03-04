import { test, expect } from "@playwright/test";
import { MapTestHelpers } from "../../helpers/map-helpers";
import { setupMapTest } from "../../helpers/test-helpers";

test.describe("Overlay Interactions", () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    mapHelpers = await setupMapTest(page);
  });

  test("should show different marker colors in edit mode based on overlay state", async ({
    page,
  }) => {
    // Navigate to overlays using proper hierarchy: country → city → overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log("No country/city markers available for testing");
      return;
    }

    // Switch to edit mode to see different marker colors
    await mapHelpers.toggleEditMode();

    // Wait for markers to update with edit mode colors
    await page.waitForTimeout(1000);

    // Get marker colors in edit mode
    const editModeColors = await mapHelpers.getVisibleMarkerColors();

    if (editModeColors.length > 0) {
      // Check for edit mode marker color states
      // Green = remote overlay not modified
      // Orange = remote overlay modified locally
      // Red = local overlay with changes
      // Blue = new overlay no changes
      // Purple = local replacement overlay (before submission)
      // Yellow = submitted replacement overlay or pending approval

      const validEditColors = ["green", "orange", "red", "blue", "purple", "yellow"];
      const foundEditColors = editModeColors.filter((color) => validEditColors.includes(color));

      console.log(`Found overlay marker colors in edit mode: ${foundEditColors.join(", ")}`);
      expect(foundEditColors.length).toBeGreaterThan(0);
    }
  });

  test("should show construction timeline colors in view mode", async ({ page }) => {
    // Navigate to overlays using proper hierarchy: country → city → overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log("No country/city markers available for testing");
      return;
    }

    // Ensure we're in view mode
    if (await mapHelpers.isEditModeActive()) {
      await mapHelpers.toggleEditMode();
    }

    // Wait for markers to update to view mode colors
    await page.waitForTimeout(500);

    // Get marker colors in view mode
    const viewModeColors = await mapHelpers.getVisibleMarkerColors();

    if (viewModeColors.length > 0) {
      // In view mode, overlays should show timeline-based colors (currently blue)
      const timelineColors = ["blue"];
      const foundTimelineColors = viewModeColors.filter((color) => timelineColors.includes(color));

      console.log(`Found timeline colors in view mode: ${foundTimelineColors.join(", ")}`);
      expect(foundTimelineColors.length).toBeGreaterThan(0);
    }
  });

  test("should handle overlay selection and info popup", async ({ page }) => {
    // Navigate to overlays using proper hierarchy: country → city → overlays
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log("No country/city markers available for testing");
      return;
    }

    // Wait for overlays to load in sidebar
    await page.waitForTimeout(1000);

    // Click on an overlay in the sidebar
    const firstOverlay = page.locator(".overlay-card").first();

    if ((await firstOverlay.count()) > 0) {
      await firstOverlay.click();
      await page.waitForTimeout(500);

      // Check if info popup appears
      const infoPopup = page.locator('[data-testid="info-popup"]');
      if ((await infoPopup.count()) > 0) {
        await expect(infoPopup).toBeVisible();

        // Verify popup contains overlay information
        await expect(infoPopup).toContainText(/overlay|project/i);

        // Close popup
        const closeButton = infoPopup.getByRole("button", { name: "Close" });
        if ((await closeButton.count()) > 0) {
          await closeButton.click();
          await expect(infoPopup).not.toBeVisible();
        }
      }
    }
  });

  test("should handle marker clicks in proper hierarchy", async ({ page }) => {
    // Test city marker click (city markers are shown globally from the start)
    const cityMarkers = await mapHelpers.getCityMarkerCount();
    if (cityMarkers > 0) {
      const cityClicked = await mapHelpers.clickCityMarker(0);
      expect(cityClicked).toBeTruthy();

      // Should load overlays
      await page.waitForTimeout(1000);
      const overlayCount = await mapHelpers.getOverlayCount();
      console.log(`Navigation flow result - Cities: ${cityMarkers}, Overlays: ${overlayCount}`);
    }
  });

  test('should navigate to overlay location when clicking "Zoom to" button', async ({ page }) => {
    // Navigate to overlays using proper hierarchy first
    const navigationSuccess = await mapHelpers.navigateToOverlays();
    if (!navigationSuccess) {
      console.log("No country/city markers available for testing");
      return;
    }

    // Wait for overlays to load
    await page.waitForTimeout(1000);

    // Get initial map center/zoom
    const initialZoom = await mapHelpers.getCurrentZoom();

    // Click zoom to button if overlays are available
    const zoomToButton = page.getByRole("button", { name: /Zoom to/ }).first();
    if ((await zoomToButton.count()) > 0) {
      await zoomToButton.click();
      await page.waitForTimeout(1000);

      // Verify map position changed
      const newZoom = await mapHelpers.getCurrentZoom();

      // Zoom level should have changed (increased)
      if (initialZoom && newZoom) {
        expect(newZoom).toBeGreaterThan(initialZoom);
      }
    }
  });
});
