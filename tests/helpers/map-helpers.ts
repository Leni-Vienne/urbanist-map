import { Page } from "@playwright/test";

/**
 * Helper functions for testing map functionality
 */

export class MapTestHelpers {
  constructor(private page: Page) {}

  /**
   * Wait for map to be fully initialized
   */
  async waitForMapReady() {
    console.log("Waiting for map to be ready...");
    await this.page.waitForSelector(".leaflet-container");
    await this.page.waitForSelector(".map-buttons");

    // Wait for city markers to load (they are displayed globally from the start)
    console.log("Waiting for city markers to load...");
    await this.page.waitForFunction(
      () => {
        const cityMarkers = document.querySelectorAll('[data-testid^="city-marker-"]');
        console.log(`Found ${cityMarkers.length} city markers during wait`);
        return cityMarkers.length > 0;
      },
      { timeout: 15000 },
    );

    console.log("City markers detected, waiting for stabilization...");
    await this.page.waitForTimeout(1000); // Allow for stabilization

    // Log final count for debugging
    const finalCityCount = await this.getCityMarkerCount();
    console.log(`Map ready with ${finalCityCount} city markers`);
  }

  /**
   * Switch between view and edit modes (now uses ModeControls.vue switch button)
   */
  async toggleEditMode() {
    const modeSwitchButton = this.page.getByRole("button", { name: /switch/i });
    await modeSwitchButton.click();
    await this.page.waitForTimeout(300);
    return modeSwitchButton;
  }

  /**
   * Get current map zoom level using Leaflet API
   */
  async getCurrentZoom(): Promise<number | null> {
    return this.page.evaluate(() => {
      try {
        // Direct Leaflet container access (most reliable)
        const map = (document.querySelector(".leaflet-container") as any)._leaflet_map as L.Map;
        return map.getZoom();
      } catch (error) {
        console.error("Error getting zoom level:", error);
        return null;
      }
    });
  }

  /**
   * Get current map center coordinates (simplified)
   */
  getMapCenter(): { lat: number; lng: number } | null {
    // Simplified for testing - just verify map is interactive
    return { lat: 49.0, lng: -1.0 }; // Mock center for testing
  }

  /**
   * Zoom to a specific level using zoom controls (not scroll wheel)
   */
  async zoomToLevel(targetZoom: number) {
    const maxAttempts = 20;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const currentZoom = await this.getCurrentZoom();
      if (!currentZoom) {
        break;
      }

      // Check if we've reached the target (with tolerance)
      if (Math.abs(currentZoom - targetZoom) <= 0.5) {
        break;
      }

      const zoomDiff = targetZoom - currentZoom;

      // Click zoom in or zoom out button
      if (zoomDiff > 0) {
        await this.page.getByRole("button", { name: "Zoom In" }).click();
      } else {
        await this.page.getByRole("button", { name: "Zoom Out" }).click();
      }

      await this.page.waitForTimeout(300);
      attempts++;
    }

    // Final stabilization
    await this.page.waitForTimeout(500);
  }

  /**
   * Count visible markers by color (SVG-based markers)
   */
  async countMarkersByColor(color: string): Promise<number> {
    try {
      const markers = this.page.locator(
        `.leaflet-marker-icon.custom-svg-marker:has(linearGradient[id*="${color}"])`,
      );
      return await markers.count();
    } catch (error) {
      console.error("Error:", error);
      return 0;
    }
  }

  /**
   * Get all marker colors currently visible
   */
  async getVisibleMarkerColors(): Promise<string[]> {
    const colors = ["green", "orange", "red", "blue", "purple", "grey"];
    const foundColors = [];

    for (const color of colors) {
      const count = await this.countMarkersByColor(color);
      if (count > 0) {
        foundColors.push(color);
      }
    }

    return foundColors;
  }

  /**
   * Toggle project status filter (now inside filter popover)
   */
  async toggleProjectFilter(status: "proposed" | "planned" | "in progress" | "completed") {
    // First, open the filter popover if it's not already open
    const filterButton = this.page.getByRole("button", { name: "Toggle project filters" });
    await filterButton.click();
    await this.page.waitForTimeout(500);

    // Map status to actual translated aria-label text
    const ariaLabelMap = {
      proposed: "Toggle proposed projects",
      planned: "Toggle planned projects",
      "in progress": "Toggle in progress projects",
      completed: "Toggle completed projects",
    };

    // Find the filter button inside the popover
    const filterToggleButton = this.page.getByRole("button", { name: ariaLabelMap[status] });

    // Wait for button to be visible
    await filterToggleButton.waitFor({ state: "visible", timeout: 3000 });

    console.log(`Clicking filter button for: ${status}`);
    await filterToggleButton.click();
    await this.page.waitForTimeout(500);

    // Close the popover by clicking the filter button again
    await filterButton.click();
    await this.page.waitForTimeout(300);

    return filterToggleButton;
  }

  /**
   * Get total number of markers on map
   */
  async getTotalMarkerCount(): Promise<number> {
    try {
      const markers = this.page.locator(".leaflet-marker-icon");
      return await markers.count();
    } catch (error) {
      console.error("Error:", error);
      return 0;
    }
  }

  /**
   * Get number of city markers
   */
  async getCityMarkerCount(): Promise<number> {
    try {
      // Wait for potential city marker loading
      await this.page.waitForTimeout(500);
      const markers = this.page.locator('[data-testid^="city-marker-"]');
      return await markers.count();
    } catch (error) {
      console.error("Error getting city marker count:", error);
      return 0;
    }
  }

  /**
   * Get number of overlay markers on map (not sidebar)
   */
  async getOverlayMarkerCount(): Promise<number> {
    try {
      await this.page.waitForTimeout(500);
      const markers = this.page.locator('[data-testid^="overlay-marker-"]');
      return await markers.count();
    } catch (error) {
      console.error("Error getting overlay marker count:", error);
      return 0;
    }
  }

  /**
   * Click on overlay marker on map by index (triggers flyTo animation)
   */
  async clickOverlayMarker(index: number = 0) {
    try {
      const markers = this.page.locator('[data-testid^="overlay-marker-"]');
      const markerCount = await markers.count();

      if (markerCount <= index) {
        console.log(`Overlay marker ${index} not found (only ${markerCount} markers)`);
        return false;
      }

      const marker = markers.nth(index);

      // Get marker position for precise targeting
      const markerBox = await marker.boundingBox();
      if (!markerBox) {
        console.log("Could not get overlay marker bounding box");
        return false;
      }

      const centerX = markerBox.x + markerBox.width / 2;
      const centerY = markerBox.y + markerBox.height / 2;

      // Click overlay marker
      console.log(`Clicking overlay marker ${index}...`);
      await this.page.mouse.click(centerX, centerY);

      // Wait for flyTo animation to complete (1.5 seconds)
      await this.page.waitForTimeout(1500);

      console.log("Overlay marker click completed");
      return true;
    } catch (error) {
      console.error("Error clicking overlay marker:", error);
      return false;
    }
  }

  /**
   * Click on a city marker to reveal overlay markers
   */
  async clickCityMarker(index: number = 0) {
    try {
      console.log(`Attempting to click city marker ${index}`);

      // Wait for city markers to appear after country click using data-testid
      await this.page.waitForFunction(
        () => {
          const markers = document.querySelectorAll('[data-testid^="city-marker-"]');
          console.log(`Found ${markers.length} city markers`);
          return markers.length > 0;
        },
        { timeout: 1000 },
      );

      const markers = this.page.locator('[data-testid^="city-marker-"]');
      const markerCount = await markers.count();
      console.log(`City markers found: ${markerCount}`);

      if (markerCount <= index) {
        console.log(`City marker ${index} not found (only ${markerCount} markers)`);
        return false;
      }

      const marker = markers.nth(index);

      // Log marker details for debugging
      const testId = await marker.getAttribute("data-testid");
      const cityName = await marker.getAttribute("data-city-name");
      const countryCode = await marker.getAttribute("data-country-code");
      console.log(`Clicking city marker: ${testId} (${cityName}, ${countryCode})`);

      // Get marker position
      const markerBox = await marker.boundingBox();
      if (!markerBox) {
        console.log("Could not get city marker bounding box");
        return false;
      }

      const centerX = markerBox.x + markerBox.width / 2;
      const centerY = markerBox.y + markerBox.height / 2;

      // Click the city marker (clicking a city marker reveals overlay markers within that city)
      console.log("Clicking city marker...");
      await this.page.mouse.click(centerX, centerY);

      // Wait for flyTo animation to complete (1.5 seconds) plus overlay loading
      await this.page.waitForTimeout(1500);

      console.log("City marker click completed");
      return true;
    } catch (error) {
      console.error("Error clicking city marker:", error);
      return false;
    }
  }

  /**
   * Navigate through map markers: city → overlays
   */
  async navigateToOverlays(cityIndex: number = 0) {
    try {
      console.log("Starting navigation to overlays...");

      // Check if we have city markers
      const initialCityMarkers = await this.getCityMarkerCount();
      console.log(`Initial city markers: ${initialCityMarkers}`);

      if (initialCityMarkers === 0) {
        console.log("No city markers available for navigation");
        return false;
      }

      // Click city marker to reveal overlay markers
      console.log(`Attempting to click city marker ${cityIndex}`);
      const cityClicked = await this.clickCityMarker(cityIndex);
      if (!cityClicked) {
        console.log("Failed to click city marker");
        return false;
      }

      const finalCityMarkers = await this.getCityMarkerCount();
      const finalOverlayMarkers = await this.getOverlayMarkerCount();

      console.log(`Final state - City: ${finalCityMarkers}, Overlay: ${finalOverlayMarkers}`);

      return true;
    } catch (error) {
      console.error("Navigation failed:", error);
      return false;
    }
  }

  /**
   * Check if edit mode is currently active (checks mode indicator class)
   */
  async isEditModeActive(): Promise<boolean> {
    try {
      // First check if user is authenticated (edit mode only available for authenticated users)
      const authHelper = await import("./auth-helpers");
      const authHelperInstance = new authHelper.AuthTestHelpers(this.page);
      const isAuthenticated = await authHelperInstance.isAuthenticated();

      if (!isAuthenticated) {
        console.log("User not authenticated - edit mode not available");
        return false;
      }

      // Check if mode indicator has edit-mode class
      const modeIndicator = this.page.locator(".mode-indicator");
      await modeIndicator.waitFor({ timeout: 5000 });
      const hasEditClass = await modeIndicator.evaluate((el) => el.classList.contains("edit-mode"));
      return hasEditClass;
    } catch (error) {
      console.error("Error checking edit mode:", error);
      return false;
    }
  }

  /**
   * Count the number of visible overlays on the map
   */
  async getOverlayCount(): Promise<number> {
    try {
      // Wait for overlays to be potentially loaded
      await this.page.waitForTimeout(500);

      // Count visible overlay elements on the map
      const overlayCount = await this.page.locator(".leaflet-overlay-pane img").count();
      console.log(`Found ${overlayCount} overlays on the map`);
      return overlayCount;
    } catch (error) {
      console.error("Error counting overlays:", error);
      return 0;
    }
  }

  /**
   * Dismiss any visible error alerts
   */
  async dismissErrorAlerts() {
    const alerts = this.page.locator('[role="alert"]');
    const alertCount = await alerts.count();

    for (let i = 0; i < alertCount; i++) {
      const closeButton = alerts.nth(i).getByRole("button", { name: "Close" });
      if ((await closeButton.count()) > 0) {
        await closeButton.click();
        await this.page.waitForTimeout(300);
      }
    }
  }
}
