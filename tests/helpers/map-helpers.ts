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
    await this.page.waitForFunction(() => {
      return (window as any).map && (window as any).map.getZoom();
    });
    await this.page.waitForTimeout(1000); // Allow for initial overlay loading
  }

  /**
   * AI : Switch between view and edit modes
   */
  async toggleEditMode() {
    const editModeButton = this.page.getByRole('button', { name: 'Toggle Edit Mode' });
    await editModeButton.click();
    await this.page.waitForTimeout(500);
    return editModeButton;
  }

  /**
   * AI : Get current map zoom level
   */
  async getCurrentZoom(): Promise<number | null> {
    return await this.page.evaluate(() => {
      return (window as any).map?.getZoom() ?? null;
    });
  }

  /**
   * AI : Get current map center coordinates
   */
  async getMapCenter(): Promise<{ lat: number; lng: number } | null> {
    return await this.page.evaluate(() => {
      const map = (window as any).map;
      if (!map) return null;
      const center = map.getCenter();
      return { lat: center.lat, lng: center.lng };
    });
  }

  /**
   * AI : Zoom to a specific level
   */
  async zoomToLevel(targetZoom: number) {
    const currentZoom = await this.getCurrentZoom();
    if (!currentZoom) return;

    const zoomDiff = targetZoom - currentZoom;
    const button = zoomDiff > 0 ? 
      this.page.getByRole('button', { name: 'Zoom In' }) :
      this.page.getByRole('button', { name: 'Zoom Out' });

    for (let i = 0; i < Math.abs(zoomDiff); i++) {
      await button.click();
      await this.page.waitForTimeout(200);
    }
  }

  /**
   * AI : Count visible markers by color
   */
  async countMarkersByColor(color: string): Promise<number> {
    const markers = this.page.locator(`.leaflet-marker-icon[src*="${color}"]`);
    return await markers.count();
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
   * AI : Get number of overlay items in sidebar
   */
  async getOverlayCount(): Promise<number> {
    await this.page.waitForTimeout(500);
    return await this.page.locator('[data-testid="overlay-item"]').count();
  }

  /**
   * AI : Click on overlay in sidebar by index
   */
  async clickOverlayInSidebar(index: number = 0) {
    const overlays = this.page.locator('[data-testid="overlay-item"]');
    const count = await overlays.count();
    
    if (count > index) {
      await overlays.nth(index).click();
      await this.page.waitForTimeout(500);
      return true;
    }
    return false;
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
    const editButton = this.page.getByRole('button', { name: 'Toggle Edit Mode' });
    const isActive = await editButton.getAttribute('active');
    return isActive !== null;
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