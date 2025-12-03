import L from 'leaflet';
import { loadCityProjects } from '@composables/map/useCityMarkers';
import { navigateToOverlay, selectOverlay } from '@composables/overlay/useOverlay';
import { prepareCountryContext } from '@composables/map/useCountryMarkers';
import { map } from '@composables/core/useMap';
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from '@composables/map/useMapNavigation';
import { useMapStore } from '@stores/pinia/mapStore';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import type { OverlayObject } from '@types';

/**
 * AI : Get the corners that should be used for navigation based on current display state
 * AI : Respects whether user is viewing suggested position or approved position
 * @param overlay - The overlay object
 * @returns Corners to navigate to (suggested or approved)
 */
function getCurrentDisplayCorners(overlay: OverlayObject): { lat: number; lng: number }[] | null {
  // AI : If overlay has Leaflet instance, get actual rendered corners (most accurate)
  if (overlay.overlay) {
    const actualCorners = overlay.overlay.getCorners();
    if (actualCorners?.length === 4) {
      return actualCorners.map(c => ({ lat: c.lat, lng: c.lng }));
    }
  }

  // AI : If user is viewing suggested position, use suggestedCorners
  if (overlay.isViewingApprovedPosition === false && overlay.suggestedCorners?.length === 4) {
    return overlay.suggestedCorners;
  }

  // AI : Default: use approved corners
  if (overlay.corners?.length === 4) {
    return overlay.corners;
  }

  return null;
}

/**
 * AI : Shared logic for navigating to a location by simulating country → city marker clicks
 * AI : This loads the country cities, adds city markers, and load city projects
 */
async function prepareNavigationToCity(
  cityId: string,
  cityName: string,
  countryCode?: string
): Promise<void> {
  if (countryCode) {
    // AI : Step 1: Simulate country marker click - prepare country context
    await prepareCountryContext(countryCode);
  }

  // AI : Step 2: Simulate city marker click (this loads and renders all markers and overlays for the city)
  await loadCityProjects(cityId, cityName, false, countryCode);
}

/**
 * AI : Zoom to overlay and select it once rendered
 */
function zoomToOverlayAndSelect(overlayId: string, corners: { lat: number; lng: number }[]): boolean {
  if (!map.value || corners.length !== 4) return false;

  const bounds = L.latLngBounds(corners.map(c => L.latLng(c.lat, c.lng)));
  mobileAwareFlyToBounds(bounds, {
    padding: [50, 50] as [number, number],
    duration: 1.5,
    easeLinearity: 0.25
  });

  map.value.once('moveend', () => {
    // AI : selectOverlay handles overlay.select() internally
    selectOverlay(overlayId);
  });

  return true;
}

/**
 * AI : Navigates to an overlay by simulating the complete marker click flow
 * AI : This replicates exactly what happens when clicking country marker → city marker → overlay
 * @param overlayId - The ID of the overlay to navigate to
 * @param cityId - The city ID where the overlay is located
 * @param cityName - The name of the city
 * @param countryCode - The country code for proper tile layer switching
 * @returns boolean indicating whether navigation was successful
 */
export async function navigateToOverlayWithCity(
  overlayId: string,
  cityId: string,
  cityName: string,
  countryCode?: string
): Promise<boolean> {
  try {
    const mapStore = useMapStore();
    const overlayStore = useOverlayStore();

    // AI : Optimization 1: Check if clicking the same overlay again
    if (overlayStore.idSelectedOverlay === overlayId) {
      const overlayObject = overlayStore.overlays[overlayId];
      if (overlayObject != null) {
        // AI : Respect current display position (suggested or approved)
        const corners = getCurrentDisplayCorners(overlayObject);
        if (corners != null) {
          zoomToOverlayAndSelect(overlayId, corners);
        }
      }
      return true;
    }

    // AI : Optimization 2: Check if overlay is from the currently selected city
    const currentCity = mapStore.selectedCity;
    const isSameCity = currentCity?.id === cityId;

    if (isSameCity) {
      const overlayObject = overlayStore.overlays[overlayId];

      // AI : If overlay is loaded, respect its current display position
      if (overlayObject != null) {
        const corners = getCurrentDisplayCorners(overlayObject);
        if (corners != null) {
          return zoomToOverlayAndSelect(overlayId, corners);
        }
      } else {
        // AI : Fallback to data corners if overlay not yet loaded
        const overlayData = mapStore.currentCityOverlays.find(o => o.id === overlayId);
        if (overlayData?.corners != null) {
          return zoomToOverlayAndSelect(overlayId, overlayData.corners);
        }
      }
    }

    // AI : Different city or no data - load everything
    await prepareNavigationToCity(cityId, cityName, countryCode);

    if (!map.value) {
      return false;
    }

    // AI : Get the overlay data from mapStore (already loaded by getCityOverlaysAndProjects)
    const overlayData = mapStore.currentCityOverlays.find(o => o.id === overlayId);

    if (overlayData?.corners != null) {
      return zoomToOverlayAndSelect(overlayId, overlayData.corners);
    }

    // AI : Fallback: if overlay not in current city overlays, use the old method
    return await navigateToOverlay(overlayId, true, false);
  } catch (error) {
    console.error('Failed to navigate to overlay with city:', error);
    throw error;
  }
}

/**
 * AI : Navigates to a marker project by simulating the complete marker click flow
 * AI : This replicates exactly what happens when clicking country marker → city marker
 * @param lat - Latitude of the marker project
 * @param lng - Longitude of the marker project
 * @param cityId - The city ID where the marker project is located
 * @param cityName - The name of the city
 * @param countryCode - The country code for proper tile layer switching
 * @param projectId - Optional project ID to open the info popup after navigation
 */
export async function navigateToStandaloneProject(
  lat: number,
  lng: number,
  cityId: string,
  cityName: string,
  countryCode?: string,
  projectId?: string
): Promise<void> {
  try {
    // AI : Prepare navigation (load country cities and city projects)
    await prepareNavigationToCity(cityId, cityName, countryCode);

    // AI : Wait a bit for markers to be added to the map
    await new Promise(resolve => setTimeout(resolve, 200));

    // AI : Fly to marker project coordinates
    if (!map.value) {
      throw new Error('Map is not initialized');
    }

    mobileAwareFlyTo([lat, lng], 18, {
      duration: 1.5,
      easeLinearity: 0.25
    });

    // AI : If projectId provided, open the project info popup after flyTo completes
    if (projectId) {
      // AI : Wait for the flyTo animation to complete
      map.value.once('moveend', () => {
        if (!map.value) return;

        // AI : Find the marker on the map and trigger click to open popup
        const standaloneProjectLayer = (map.value as any)._layers;
        let foundMarker: L.Marker | null = null;

        Object.values(standaloneProjectLayer).forEach((layer: any) => {
          if (layer instanceof L.Marker) {
            const markerLatLng = layer.getLatLng();
            // AI : Check if this marker is at the same position as our target
            if (Math.abs(markerLatLng.lat - lat) < 0.0001 && Math.abs(markerLatLng.lng - lng) < 0.0001) {
              foundMarker = layer;
            }
          }
        });

        // AI : Click the marker to open the popup (which will also update opacity)
        if (foundMarker) {
          (foundMarker as any).fire('click');
        }
      });
    }
  } catch (error) {
    console.error('Failed to navigate to marker project:', error);
    throw error;
  }
}
