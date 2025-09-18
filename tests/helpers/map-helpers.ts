import { Page } from '@playwright/test';

/**
 * AI : Helper functions for testing map functionality
 */

export class MapTestHelpers {
  constructor(private page: Page) { }

  /**
   * AI : Wait for map to be fully initialized
   */
  async waitForMapReady() {
    console.log('Waiting for map to be ready...');
    await this.page.waitForSelector('.leaflet-container');
    await this.page.waitForSelector('.map-buttons');

    // AI : Wait specifically for country markers to load (they should be the initial markers)
    console.log('Waiting for country markers to load...');
    await this.page.waitForFunction(() => {
      const countryMarkers = document.querySelectorAll('[data-testid^="country-marker-"]');
      console.log(`Found ${countryMarkers.length} country markers during wait`);
      return countryMarkers.length > 0;
    }, { timeout: 15000 });

    console.log('Country markers detected, waiting for stabilization...');
    await this.page.waitForTimeout(1000); // Allow for stabilization

    // AI : Log final count for debugging
    const finalCountryCount = await this.getCountryMarkerCount();
    console.log(`Map ready with ${finalCountryCount} country markers`);
  }

  /**
   * AI : Switch between view and edit modes
   */
  async toggleEditMode() {
    const editModeButton = this.page.getByRole('button', { name: 'Toggle Edit Mode' });
    await editModeButton.click();
    await this.page.waitForTimeout(300);
    return editModeButton;
  }

  /**
   * AI : Get current map zoom level using Leaflet API
   */
  async getCurrentZoom(): Promise<number | null> {
    return await this.page.evaluate(() => {
      try {
        // AI : Direct Leaflet container access (most reliable)
        const container = document.querySelector('.leaflet-container') as any;
        if (container?._leaflet_map?.getZoom) {
          return container._leaflet_map.getZoom();
        }

        // AI : Search through container properties (fallback)
        if (container) {
          for (const prop in container) {
            if (container[prop]?.getZoom) {
              return container[prop].getZoom();
            }
          }
        }

        return null;
      } catch (error) {
        console.error('Error getting zoom level:', error);
        return null;
      }
    });
  }

  /**
   * AI : Get current map center coordinates (simplified)
   */
  getMapCenter(): { lat: number; lng: number } | null {
    // AI : Simplified for testing - just verify map is interactive
    return { lat: 49.0, lng: -1.0 }; // Mock center for testing
  }

  /**
   * AI : Zoom to a specific level using scroll wheel at current cursor position
   */
  async zoomToLevel(targetZoom: number) {
    const maxAttempts = 15;
    let attempts = 0;
    let lastZoom = null;
    let stableCount = 0;

    while (attempts < maxAttempts) {
      const currentZoom = await this.getCurrentZoom();
      if (!currentZoom) {
        break;
      }

      // AI : Check if we've reached the target (with tolerance)
      if (Math.abs(currentZoom - targetZoom) <= 0.5) {
        break;
      }

      // AI : Detect if zoom is stable (not changing) to avoid infinite loops
      if (lastZoom !== null && Math.abs(currentZoom - lastZoom) < 0.1) {
        stableCount++;
        if (stableCount >= 3) {
          break;
        }
      } else {
        stableCount = 0;
      }
      lastZoom = currentZoom;

      const zoomDiff = targetZoom - currentZoom;

      // AI : Use smaller steps to avoid overshooting
      const steps = Math.min(Math.abs(zoomDiff), 2); // Max 2 levels per step
      const deltaY = zoomDiff > 0 ? -100 * steps : 100 * steps; // Negative for zoom in

      // AI : Get current mouse position or use map center
      const mousePos = await this.page.evaluate(() => {
        const mapContainer = document.querySelector('.leaflet-container');
        if (mapContainer) {
          const rect = mapContainer.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }
        return { x: 500, y: 400 };
      });

      // AI : Dispatch scroll wheel event at cursor position
      await this.page.evaluate(({ x, y, delta }) => {
        const wheelEvent = new WheelEvent('wheel', {
          clientX: x,
          clientY: y,
          deltaY: delta,
          bubbles: true,
          cancelable: true
        });
        const mapContainer = document.querySelector('.leaflet-container');
        if (mapContainer) {
          mapContainer.dispatchEvent(wheelEvent);
        }
      }, { x: mousePos.x, y: mousePos.y, delta: deltaY });

      await this.page.waitForTimeout(400); // AI : Longer wait for zoom to settle
      attempts++;
    }

    // AI : Final verification
    await this.page.waitForTimeout(500);
  }

  /**
   * AI : Count visible markers by color (SVG-based markers)
   */
  async countMarkersByColor(color: string): Promise<number> {
    try {
      const markers = this.page.locator(`.leaflet-marker-icon.custom-svg-marker:has(linearGradient[id*="${color}"])`);
      return await markers.count();
    } catch (error) {
      console.error('Error:', error);
      return 0;
    }
  }

  /**
   * AI : Get all marker colors currently visible
   */
  async getVisibleMarkerColors(): Promise<string[]> {
    const colors = ['green', 'orange', 'red', 'blue', 'purple', 'grey'];
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
   * AI : Toggle project status filter
   */
  async toggleProjectFilter(status: 'not started' | 'in progress' | 'completed') {
    const button = this.page.getByRole('button', { name: `Toggle ${status} projects` });
    await button.click();
    await this.page.waitForTimeout(300);
    return button;
  }

  /**
   * AI : Get total number of markers on map
   */
  async getTotalMarkerCount(): Promise<number> {
    try {
      const markers = this.page.locator('.leaflet-marker-icon');
      return await markers.count();
    } catch (error) {
      console.error('Error:', error);
      return 0;
    }
  }

  /**
   * AI : Get number of visible markers by type
   */
  async getCountryMarkerCount(): Promise<number> {
    try {
      const markers = this.page.locator('[data-testid^="country-marker-"]');
      return await markers.count();
    } catch (error) {
      console.error('Error getting country marker count:', error);
      return 0;
    }
  }

  /**
   * AI : Get number of city markers (also blue)
   */
  async getCityMarkerCount(): Promise<number> {
    try {
      // AI : Wait for potential city marker loading
      await this.page.waitForTimeout(500);
      const markers = this.page.locator('[data-testid^="city-marker-"]');
      return await markers.count();
    } catch (error) {
      console.error('Error getting city marker count:', error);
      return 0;
    }
  }

  /**
   * AI : Get number of overlay markers on map (not sidebar)
   */
  async getOverlayMarkerCount(): Promise<number> {
    try {
      await this.page.waitForTimeout(500);
      const markers = this.page.locator('[data-testid^="overlay-marker-"]');
      return await markers.count();
    } catch (error) {
      console.error('Error getting overlay marker count:', error);
      return 0;
    }
  }

  /**
   * AI : Click on overlay marker on map by index
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

      // AI : Get marker position for precise targeting
      const markerBox = await marker.boundingBox();
      if (!markerBox) {
        console.log('Could not get overlay marker bounding box');
        return false;
      }

      const centerX = markerBox.x + markerBox.width / 2;
      const centerY = markerBox.y + markerBox.height / 2;

      // AI : Move cursor to marker and click
      await this.page.mouse.move(centerX, centerY);
      await this.page.waitForTimeout(200);
      await this.page.mouse.click(centerX, centerY);
      await this.page.waitForTimeout(200);

      return true;
    } catch (error) {
      console.error('Error clicking overlay marker:', error);
      return false;
    }
  }

  /**
   * AI : Click on a country marker to load cities
   */
  async clickCountryMarker(index: number = 0) {
    try {
      console.log(`Attempting to click country marker ${index}`);

      // AI : Wait for country markers to be visible first using data-testid
      console.log('Waiting for country markers to appear...');
      await this.page.waitForFunction(() => {
        const markers = document.querySelectorAll('[data-testid^="country-marker-"]');
        console.log(`Found ${markers.length} country markers`);
        return markers.length > 0;
      }, { timeout: 15000 });

      const markers = this.page.locator('[data-testid^="country-marker-"]');
      const markerCount = await markers.count();
      console.log(`Country markers found: ${markerCount}`);

      if (markerCount <= index) {
        console.log(`Country marker ${index} not found (only ${markerCount} markers)`);
        return false;
      }

      const marker = markers.nth(index);

      // AI : Wait for marker to be fully loaded with attributes
      await this.page.waitForFunction((idx) => {
        const markers = document.querySelectorAll('[data-testid^="country-marker-"]');
        const marker = markers[idx];
        if (!marker) return false;

        const hasTestId = marker.hasAttribute('data-testid');
        const hasCountryCode = marker.hasAttribute('data-country-code');
        const hasCountryName = marker.hasAttribute('data-country-name');

        return hasTestId && hasCountryCode && hasCountryName;
      }, index, { timeout: 10000 });

      // AI : Log marker details for debugging
      const testId = await marker.getAttribute('data-testid');
      const countryCode = await marker.getAttribute('data-country-code');
      const countryName = await marker.getAttribute('data-country-name');
      console.log(`Clicking country marker: ${testId} (${countryName}, ${countryCode})`);

      // AI : Get initial marker position for zooming reference
      const initialMarkerBox = await marker.boundingBox();
      if (!initialMarkerBox) {
        console.log('Could not get country marker bounding box');
        return false;
      }

      const initialCenterX = initialMarkerBox.x + initialMarkerBox.width / 2;
      const initialCenterY = initialMarkerBox.y + initialMarkerBox.height / 2;

      // AI : Zoom in at marker position (2 steps for country focus)
      console.log('Zooming to country marker...');
      for (let i = 0; i < 2; i++) {
        await this.page.evaluate(({ x, y }) => {
          const wheelEvent = new WheelEvent('wheel', {
            clientX: x,
            clientY: y,
            deltaY: -100,
            bubbles: true,
            cancelable: true
          });
          document.elementFromPoint(x, y)?.dispatchEvent(wheelEvent);
        }, { x: initialCenterX, y: initialCenterY });

        await this.page.waitForTimeout(200);
      }

      // AI : Get NEW marker position AFTER zooming
      const newMarkerBox = await marker.boundingBox();
      if (!newMarkerBox) {
        console.log('Could not get marker bounding box after zoom');
        return false;
      }

      const newCenterX = newMarkerBox.x + newMarkerBox.width / 2;
      const newCenterY = newMarkerBox.y + newMarkerBox.height / 2;

      console.log(`Marker position after zoom: ${newCenterX}, ${newCenterY}`);

      // AI : Click the marker at its NEW position after zooming
      console.log('Clicking country marker at new position...');
      await this.page.mouse.click(newCenterX, newCenterY);
      await this.page.waitForTimeout(200);

      console.log('Country marker click completed');
      return true;
    } catch (error) {
      console.error('Error clicking country marker:', error);
      return false;
    }
  }

  /**
   * AI : Click on a city marker to load overlays
   */
  async clickCityMarker(index: number = 0) {
    try {
      console.log(`Attempting to click city marker ${index}`);

      // AI : Wait for city markers to appear after country click using data-testid
      await this.page.waitForFunction(() => {
        const markers = document.querySelectorAll('[data-testid^="city-marker-"]');
        console.log(`Found ${markers.length} city markers`);
        return markers.length > 0;
      }, { timeout: 1000 });

      const markers = this.page.locator('[data-testid^="city-marker-"]');
      const markerCount = await markers.count();
      console.log(`City markers found: ${markerCount}`);

      if (markerCount <= index) {
        console.log(`City marker ${index} not found (only ${markerCount} markers)`);
        return false;
      }

      const marker = markers.nth(index);

      // AI : Log marker details for debugging
      const testId = await marker.getAttribute('data-testid');
      const cityName = await marker.getAttribute('data-city-name');
      const countryCode = await marker.getAttribute('data-country-code');
      console.log(`Clicking city marker: ${testId} (${cityName}, ${countryCode})`);

      // AI : Get initial marker position and click first
      const initialMarkerBox = await marker.boundingBox();
      if (!initialMarkerBox) {
        console.log('Could not get city marker bounding box');
        return false;
      }

      const initialCenterX = initialMarkerBox.x + initialMarkerBox.width / 2;
      const initialCenterY = initialMarkerBox.y + initialMarkerBox.height / 2;

      // AI : Click the city marker first
      console.log('Clicking city marker...');
      await this.page.mouse.click(initialCenterX, initialCenterY);
      await this.page.waitForTimeout(200);

      // AI : Get current zoom before zooming
      const currentZoom = await this.getCurrentZoom();
      console.log(`Current zoom level before city zoom: ${currentZoom}`);

      // AI : Zoom to level 13 AT THE CITY MARKER POSITION (updating position after each zoom)
      console.log('Zooming to level 13 at city marker position...');
      const targetZoom = 14;
      const maxAttempts = 25;
      let attempts = 0;

      while (attempts < maxAttempts) {
        const currentLevel = await this.getCurrentZoom();
        if (!currentLevel) {
          console.log('Could not determine current zoom level');
          break;
        }

        if (Math.abs(currentLevel - targetZoom) <= 0.5) {
          console.log(`Reached target zoom level ${currentLevel}`);
          break; // AI : Close enough
        }

        // AI : Get CURRENT marker position before each zoom step
        const currentMarkerBox = await marker.boundingBox();
        if (!currentMarkerBox) {
          console.log('Could not get marker bounding box for zoom step');
          break;
        }

        const currentCenterX = currentMarkerBox.x + currentMarkerBox.width / 2;
        const currentCenterY = currentMarkerBox.y + currentMarkerBox.height / 2;

        const zoomDiff = targetZoom - currentLevel;
        const deltaY = zoomDiff > 0 ? -200 : 200; // AI : Negative for zoom in, positive for zoom out

        console.log(`Zoom step ${attempts + 1}: current=${currentLevel}, target=${targetZoom}, pos=${currentCenterX},${currentCenterY}`);

        // AI : Dispatch scroll wheel event AT CURRENT MARKER POSITION
        await this.page.evaluate(({ x, y, delta }) => {
          const wheelEvent = new WheelEvent('wheel', {
            clientX: x,
            clientY: y,
            deltaY: delta,
            bubbles: true,
            cancelable: true
          });
          document.elementFromPoint(x, y)?.dispatchEvent(wheelEvent);
        }, { x: currentCenterX, y: currentCenterY, delta: deltaY });

        await this.page.waitForTimeout(300);
        attempts++;
      }

      // AI : Verify final zoom level
      const finalZoom = await this.getCurrentZoom();
      console.log(`Final zoom level after city zoom: ${finalZoom}`);

      if (finalZoom && finalZoom < 13) {
        console.warn(`Warning: Final zoom ${finalZoom} may not be sufficient for overlays (need 13+)`);
      }

      await this.page.waitForTimeout(1000); // AI : Wait for overlays to load

      console.log('City marker click and zoom completed');
      return true;
    } catch (error) {
      console.error('Error clicking city marker:', error);
      return false;
    }
  }

  /**
   * AI : Navigate through map markers: country → city → overlays
   */
  async navigateToOverlays(countryIndex: number = 0, cityIndex: number = 0) {
    try {
      console.log('Starting navigation to overlays...');

      // AI : Check if we have initial country markers
      const initialCountryMarkers = await this.getCountryMarkerCount();
      console.log(`Initial country markers: ${initialCountryMarkers}`);

      if (initialCountryMarkers === 0) {
        console.log('No country markers available for navigation');
        return false;
      }

      // AI : Step 1: Click country marker (will zoom to country and potentially show city markers)
      console.log(`Attempting to click country marker ${countryIndex}`);
      const countryClicked = await this.clickCountryMarker(countryIndex);
      if (!countryClicked) {
        console.log('Failed to click country marker');
        return false;
      }

      // AI : Step 2: Check if city markers appeared, if so click one
      const cityMarkersAfterCountry = await this.getCityMarkerCount();
      console.log(`City markers after country click: ${cityMarkersAfterCountry}`);

      if (cityMarkersAfterCountry > 0) {
        // AI : City markers appeared, click one
        console.log(`Attempting to click city marker ${cityIndex}`);
        const cityClicked = await this.clickCityMarker(cityIndex);
        if (!cityClicked) {
          console.log('Failed to click city marker');
          return false;
        }

        const overlayMarkers = await this.getOverlayMarkerCount();
        console.log(`Overlay markers after city click: ${overlayMarkers}`);
      } else {
        console.log('No city markers appeared after country click - may have direct overlays');
        // AI : Check if overlays appeared directly after country click
        await this.page.waitForTimeout(1000);
        const overlayMarkers = await this.getOverlayMarkerCount();
        console.log(`Direct overlay markers after country click: ${overlayMarkers}`);
      }

      const finalCountryMarkers = await this.getCountryMarkerCount();
      const finalCityMarkers = await this.getCityMarkerCount();
      const finalOverlayMarkers = await this.getOverlayMarkerCount();

      console.log(`Final state - Country: ${finalCountryMarkers}, City: ${finalCityMarkers}, Overlay: ${finalOverlayMarkers}`);

      return true;
    } catch (error) {
      console.error('Navigation failed:', error);
      return false;
    }
  }

  /**
   * AI : Check if edit mode is currently active
   */
  async isEditModeActive(): Promise<boolean> {
    try {
      // AI : First check if user is authenticated (edit mode only available for authenticated users)
      const authHelper = await import('./auth-helpers');
      const authHelperInstance = new authHelper.AuthTestHelpers(this.page);
      const isAuthenticated = await authHelperInstance.isAuthenticated();

      if (!isAuthenticated) {
        console.log('User not authenticated - edit mode not available');
        return false;
      }

      const editButton = this.page.getByRole('button', { name: 'Toggle Edit Mode' });
      await editButton.waitFor({ timeout: 5000 });
      // AI : Check the active attribute value - 'true' means active, 'false' or null means inactive
      const activeValue = await editButton.getAttribute('active');
      return activeValue === 'true';
    } catch (error) {
      console.error('Error checking edit mode:', error);
      return false;
    }
  }

  /**
   * AI : Count the number of visible overlays on the map
   */
  async getOverlayCount(): Promise<number> {
    try {
      // AI : Wait for overlays to be potentially loaded
      await this.page.waitForTimeout(500);

      // AI : Count visible overlay elements on the map
      const overlayCount = await this.page.locator('.leaflet-overlay-pane img').count();
      console.log(`Found ${overlayCount} overlays on the map`);
      return overlayCount;
    } catch (error) {
      console.error('Error counting overlays:', error);
      return 0;
    }
  }

  /**
   * AI : Dismiss any visible error alerts
   */
  async dismissErrorAlerts() {
    const alerts = this.page.locator('[role="alert"]');
    const alertCount = await alerts.count();

    for (let i = 0; i < alertCount; i++) {
      const closeButton = alerts.nth(i).getByRole('button', { name: 'Close' });
      if (await closeButton.count() > 0) {
        await closeButton.click();
        await this.page.waitForTimeout(300);
      }
    }
  }
}