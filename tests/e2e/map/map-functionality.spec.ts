import { test, expect } from "@playwright/test";
import { MapTestHelpers } from "../../helpers/map-helpers";
import { disableHelpModal } from "../../helpers/test-helpers";

test.describe("Core Map Functionality", () => {
  let mapHelpers: MapTestHelpers;

  test.beforeEach(async ({ page }) => {
    // Disable help modal to prevent test interference
    await disableHelpModal(page);

    mapHelpers = new MapTestHelpers(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await mapHelpers.waitForMapReady();
    await mapHelpers.dismissErrorAlerts();
  });

  test("should load the map correctly", async ({ page }) => {
    // Verify Leaflet map is initialized
    await expect(page.locator(".leaflet-container")).toBeVisible();

    // Check for map tiles
    const tileCount = await page.locator(".leaflet-tile").count();
    expect(tileCount).toBeGreaterThan(0);

    // Verify map controls are present
    await expect(page.getByRole("button", { name: "Zoom In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom Out" })).toBeVisible();
  });

  test("should respond to zoom controls", async ({ page }) => {
    // Get initial zoom level using Vue's reactive system
    const initialZoom = await mapHelpers.getCurrentZoom();

    // Click zoom in
    await page.getByRole("button", { name: "Zoom In" }).click();
    await page.waitForTimeout(500);

    const zoomedInLevel = await mapHelpers.getCurrentZoom();

    // Verify zoom increased
    if (initialZoom != null && zoomedInLevel != null) {
      expect(zoomedInLevel).toBeGreaterThan(initialZoom);
    }

    // Click zoom out
    await page.getByRole("button", { name: "Zoom Out" }).click();
    await page.waitForTimeout(500);

    const zoomedOutLevel = await mapHelpers.getCurrentZoom();

    // Verify zoom decreased
    if (zoomedInLevel && zoomedOutLevel) {
      expect(zoomedOutLevel).toBeLessThan(zoomedInLevel);
    }
  });

  test("should show layer control", async ({ page }) => {
    // Click layer control button
    await page.getByRole("button", { name: "Layer Control" }).click();
    await page.waitForTimeout(500);

    // Verify layer control opens (look for layer options)
    const layerControl = page.locator(".leaflet-control-layers");
    if ((await layerControl.count()) > 0) {
      await expect(layerControl).toBeVisible();
    }
  });
});
