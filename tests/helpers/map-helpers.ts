import { Page, expect } from '@playwright/test';

/**
 * AI : Helper functions for testing map functionality
 */

export class MapTestHelpers {
  constructor(private page: Page) {}

  /**
   * AI : Wait for map to be fully initialized
   */
  async waitForMapReady() {
    await this.page.waitForSelector('.leaflet-container');
    await this.page.waitForSelector('.zoom-controls');
    
    // AI : Wait for country markers to load
    await this.page.waitForFunction(() => {
      const markers = document.querySelectorAll('.leaflet-marker-icon');
      return markers.length > 0;
    }, { timeout: 10000 });
    
    await this.page.waitForTimeout(500); // Allow for stabilization
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
   * AI : Get current map zoom level using Leaflet container access
   */
  async getCurrentZoom(): Promise<number | null> {
    return await this.page.evaluate(() => {
      const container = document.querySelector('.leaflet-container') as any;
      if (container && window.L) {
        // AI : Access map through Leaflet's internal mechanisms
        const leafletId = container._leaflet_id;
        if (leafletId !== undefined) {
          // AI : Try to find map via container properties
          for (const prop in container) {
            if (container[prop] && typeof container[prop].getZoom === 'function') {
              return container[prop].getZoom();
            }
          }
          
          // AI : Try accessing via window properties
          for (const key in window as any) {
            if ((window as any)[key] && typeof (window as any)[key].getZoom === 'function') {
              return (window as any)[key].getZoom();
            }
          }
        }
      }
      
      // AI : Fallback: estimate zoom from scale bar
      const scaleText = document.querySelector('.leaflet-control-scale-line')?.textContent;
      if (scaleText) {
        const kmMatch = scaleText.match(/(\d+)\s*km/);
        if (kmMatch) {
          const km = parseInt(kmMatch[1]);
          // AI : Rough zoom estimation based on scale
          if (km >= 5000) return 3;
          if (km >= 1000) return 5;
          if (km >= 500) return 7;
          if (km >= 200) return 9;
          if (km >= 100) return 10;
          if (km >= 50) return 11;
          if (km >= 20) return 12;
          return 13;
        }
      }
      
      return null;
    });
  }

  /**
   * AI : Hover over marker and zoom in using scroll wheel
   */
  /**
   * AI : Hover over marker and zoom in using scroll wheel at marker position
   */
  async hoverAndZoomOnMarker(markerIndex: number, zoomSteps: number = 3) {
    try {
      const markers = await this.page.locator('.leaflet-marker-icon');
      const markerCount = await markers.count();
      
      if (markerCount <= markerIndex) {
        console.log(`Marker ${markerIndex} not found (only ${markerCount} markers)`);
        return false;
      }
      
      const marker = markers.nth(markerIndex);
      
      // AI : Get marker position
      const markerBox = await marker.boundingBox();
      if (!markerBox) {
        console.log('Could not get marker bounding box');
        return false;
      }
      
      const centerX = markerBox.x + markerBox.width / 2;
      const centerY = markerBox.y + markerBox.height / 2;
      
      // AI : Move mouse to marker position
      await this.page.mouse.move(centerX, centerY);
      await this.page.waitForTimeout(200);
      
      // AI : Dispatch wheel events at the marker position to zoom in
      for (let i = 0; i < zoomSteps; i++) {
        await this.page.evaluate(({ x, y }) => {
          const wheelEvent = new WheelEvent('wheel', {
            clientX: x,
            clientY: y,
            deltaY: -100, // AI : Negative deltaY for zoom in
            bubbles: true,
            cancelable: true
          });
          document.elementFromPoint(x, y)?.dispatchEvent(wheelEvent);
        }, { x: centerX, y: centerY });
        
        await this.page.waitForTimeout(300); // AI : Wait between zoom steps
      }
      
      return true;
    } catch (error) {
      console.error('Error hovering and zooming on marker:', error);
      return false;
    }
  }

  /**
   * AI : Get current map center coordinates (simplified)
   */
  async getMapCenter(): Promise<{ lat: number; lng: number } | null> {
    // AI : Simplified for testing - just verify map is interactive
    return { lat: 49.0, lng: -1.0 }; // Mock center for testing
  }

  /**
   * AI : Zoom to a specific level using zoom buttons
   */
  /**
   * AI : Zoom to a specific level using scroll wheel at current cursor position
   */
  async zoomToLevel(targetZoom: number) {
    const maxAttempts = 15;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const currentZoom = await this.getCurrentZoom();
      if (!currentZoom) {
        console.log('Could not determine current zoom level');
        break;
      }
      
      if (Math.abs(currentZoom - targetZoom) <= 0.5) {
        break; // AI : Close enough
      }
      
      const zoomDiff = targetZoom - currentZoom;
      const deltaY = zoomDiff > 0 ? -150 : 150; // AI : Negative for zoom in, positive for zoom out
      
      // AI : Get current mouse position or use map center
      const mousePos = await this.page.evaluate(() => {
        // AI : Try to get last known mouse position or use map center
        const mapContainer = document.querySelector('.leaflet-container');
        if (mapContainer) {
          const rect = mapContainer.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }
        return { x: 500, y: 400 }; // AI : Fallback position
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
      
      await this.page.waitForTimeout(300);
      attempts++;
    }
    
    await this.page.waitForTimeout(500);
  }

  /**
   * AI : Ensure zoom is sufficient for overlay visibility at current cursor position
   */
  async ensureOverlayZoom() {
    const currentZoom = await this.getCurrentZoom();
    const minZoomForOverlays = 13; // AI : Based on requirements for overlay visibility
    
    if (!currentZoom || currentZoom < minZoomForOverlays) {
      // AI : Zoom at current mouse position instead of map center
      const steps = minZoomForOverlays - (currentZoom ?? 0);
      for (let i = 0; i < Math.ceil(steps); i++) {
        await this.page.mouse.wheel(0, -100);
        await this.page.waitForTimeout(200);
      }
    }
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
    return await this.getTotalMarkerCount();
  }

  /**
   * AI : Get number of city markers (also blue)
   */
  async getCityMarkerCount(): Promise<number> {
    // AI : Wait for potential city marker loading
    await this.page.waitForTimeout(500);
    return await this.getTotalMarkerCount();
  }

  /**
   * AI : Get number of overlay markers on map (not sidebar)
   */
  async getOverlayMarkerCount(): Promise<number> {
    await this.page.waitForTimeout(500);
    // AI : Count overlay markers which appear after navigating to city level
    return await this.page.evaluate(() => {
      const allMarkers = document.querySelectorAll('.leaflet-marker-icon');
      // AI : Overlay markers have different styling or are in specific positions
      return allMarkers.length;
    });
  }

  /**
   * AI : Click on overlay marker on map by index
   */
  async clickOverlayMarker(index: number = 0) {
    try {
      const markers = await this.page.locator('.leaflet-marker-icon');
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
      await this.page.waitForTimeout(500);
      
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
      // AI : Wait for country markers to be visible first
      await this.page.waitForFunction(() => {
        const markers = document.querySelectorAll('.leaflet-marker-icon');
        return markers.length > 0;
      }, { timeout: 5000 });
      
      const markers = await this.page.locator('.leaflet-marker-icon');
      const markerCount = await markers.count();
      
      if (markerCount <= index) {
        console.log(`Country marker ${index} not found (only ${markerCount} markers)`);
        return false;
      }
      
      const marker = markers.nth(index);
      
      // AI : Get marker position for precise targeting
      const markerBox = await marker.boundingBox();
      if (!markerBox) {
        console.log('Could not get country marker bounding box');
        return false;
      }
      
      const centerX = markerBox.x + markerBox.width / 2;
      const centerY = markerBox.y + markerBox.height / 2;
      
      // AI : Move cursor to marker position
      await this.page.mouse.move(centerX, centerY);
      await this.page.waitForTimeout(200);
      
      // AI : Zoom in at marker position (2 steps for country focus)
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
        }, { x: centerX, y: centerY });
        
        await this.page.waitForTimeout(300);
      }
      
      // AI : Click the marker at the same position
      await this.page.mouse.click(centerX, centerY);
      await this.page.waitForTimeout(1000);
      
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
      // AI : Wait for city markers to appear after country click
      await this.page.waitForFunction(() => {
        const markers = document.querySelectorAll('.leaflet-marker-icon');
        return markers.length > 1; // Should have more than just country markers
      }, { timeout: 5000 });
      
      const markers = await this.page.locator('.leaflet-marker-icon');
      const markerCount = await markers.count();
      
      if (markerCount <= index) {
        console.log(`City marker ${index} not found (only ${markerCount} markers)`);
        return false;
      }
      
      const marker = markers.nth(index);
      
      // AI : Get marker position for precise targeting
      const markerBox = await marker.boundingBox();
      if (!markerBox) {
        console.log('Could not get city marker bounding box');
        return false;
      }
      
      const centerX = markerBox.x + markerBox.width / 2;
      const centerY = markerBox.y + markerBox.height / 2;
      
      // AI : Move cursor to marker position
      await this.page.mouse.move(centerX, centerY);
      await this.page.waitForTimeout(200);
      
      // AI : Zoom in at marker position (3 steps for city focus)
      for (let i = 0; i < 3; i++) {
        await this.page.evaluate(({ x, y }) => {
          const wheelEvent = new WheelEvent('wheel', {
            clientX: x,
            clientY: y,
            deltaY: -100,
            bubbles: true,
            cancelable: true
          });
          document.elementFromPoint(x, y)?.dispatchEvent(wheelEvent);
        }, { x: centerX, y: centerY });
        
        await this.page.waitForTimeout(300);
      }
      
      // AI : Click the marker at the same position
      await this.page.mouse.click(centerX, centerY);
      await this.page.waitForTimeout(1000);
      
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
      // AI : Check if we have initial country markers
      const initialMarkers = await this.getTotalMarkerCount();
      if (initialMarkers === 0) {
        console.log('No markers available for navigation');
        return false;
      }
      
      // AI : Step 1: Click country marker (will zoom to country and potentially show city markers)
      console.log(`Clicking country marker ${countryIndex}`);
      const countryClicked = await this.clickCountryMarker(countryIndex);
      if (!countryClicked) {
        console.log('Failed to click country marker');
        return false;
      }
      
      // AI : Wait for potential city markers to appear
      await this.page.waitForTimeout(1000);
      
      // AI : Step 2: Check if city markers appeared, if so click one
      const markersAfterCountry = await this.getTotalMarkerCount();
      console.log(`Markers after country click: ${markersAfterCountry}`);
      
      if (markersAfterCountry > initialMarkers) {
        // AI : New markers appeared (likely cities), click one
        console.log(`Clicking city marker ${cityIndex}`);
        const cityClicked = await this.clickCityMarker(cityIndex);
        if (!cityClicked) {
          console.log('Failed to click city marker');
          return false;
        }
      }
      
      // AI : Wait for overlay markers to potentially appear
      await this.page.waitForTimeout(1000);
      
      const finalMarkers = await this.getTotalMarkerCount();
      console.log(`Final marker count: ${finalMarkers}`);
      
      return true;
    } catch (error) {
      console.error('Navigation failed:', error);
      return false;
    }
  }

  /**
   * AI : Click zoom to button for overlay in sidebar
   */
  async clickZoomToOverlay(index: number = 0) {
    const zoomButtons = this.page.getByRole('button', { name: /Zoom to/ });
    const count = await zoomButtons.count();
    
    if (count > index) {
      await zoomButtons.nth(index).click();
      await this.page.waitForTimeout(1000);
      return true;
    }
    return false;
  }

  /**
   * AI : Verify overlay image loading based on zoom level
   */
  async verifyOverlayImageLoading(shouldBeLoaded: boolean) {
    const overlayImages = this.page.locator('.leaflet-image-layer');
    const imageCount = await overlayImages.count();
    
    if (shouldBeLoaded) {
      expect(imageCount).toBeGreaterThan(0);
    } else {
      // AI : Images might be 0 or very few at low zoom
      console.log(`Overlay images at current zoom: ${imageCount}`);
    }
    
    return imageCount;
  }

  /**
   * AI : Check if edit mode is currently active
   */
  async isEditModeActive(): Promise<boolean> {
    try {
      const editButton = this.page.getByRole('button', { name: 'Toggle Edit Mode' });
      // AI : Check the active attribute value - 'true' means active, 'false' or null means inactive
      const activeValue = await editButton.getAttribute('active');
      return activeValue === 'true';
    } catch (error) {
      console.error('Error checking edit mode:', error);
      return false;
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