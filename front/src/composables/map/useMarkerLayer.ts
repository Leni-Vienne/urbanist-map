// AI : Marker layer abstraction - unified handling of marker groups
// AI : Eliminates duplication across city/country/overlay marker management

import L from 'leaflet';
import type { MarkerColor } from '@types';
import { createColorIcon, createBasicProjectIcon } from '@composables/map/useMarkers';

// AI : Configuration for a marker layer
export interface MarkerLayerConfig<T> {
  // AI : Get opacity values for this marker type
  getOpacity: (hover: boolean) => number;

  // AI : Get marker color for an item
  getColor: (item: T) => MarkerColor;

  // AI : Get marker icon type ('standard' | 'development')
  getIconType?: () => 'standard' | 'development';

  // AI : Optional click handler
  onMarkerClick?: (marker: L.Marker, item: T) => void | Promise<void>;

  // AI : Optional hover handler
  onMarkerHover?: (marker: L.Marker, item: T, isHovering: boolean) => void;

  // AI : Optional function to extract lat/lng from item
  getLatLng: (item: T) => { lat: number; lng: number } | null;

  // AI : Optional tooltip text provider
  getTooltip?: (item: T) => string;

  // AI : Optional test ID provider
  getTestId?: (item: T) => string;

  // AI : Optional data attributes provider
  getDataAttributes?: (item: T) => Record<string, string>;
}

// AI : Result of creating a marker layer
export interface MarkerLayerResult {
  layer: L.LayerGroup;
  markers: Map<string, L.Marker>;
  selectedMarker: L.Marker | null;
}

/**
 * AI : Reset all markers in a layer group to default opacity
 */
export function resetLayerMarkersOpacity(layerGroup: L.LayerGroup | null, defaultOpacity: number): void {
  if (!layerGroup) return;

  layerGroup.eachLayer((layer) => {
    if (layer instanceof L.Marker) {
      layer.setOpacity(defaultOpacity);
    }
  });
}

/**
 * AI : Create a managed marker layer with unified event handling
 * This eliminates the duplicated hover/click/opacity logic across multiple composables
 */
export function createMarkerLayer<T extends { id?: string }>(
  items: T[],
  config: MarkerLayerConfig<T>
): MarkerLayerResult {
  const layer = L.layerGroup();
  const markers = new Map<string, L.Marker>();
  let selectedMarker: L.Marker | null = null;

  const iconType = config.getIconType?.() ?? 'standard';
  const defaultOpacity = config.getOpacity(false);
  const hoverOpacity = config.getOpacity(true);

  items.forEach((item) => {
    const latLng = config.getLatLng(item);
    if (!latLng) return;

    // AI : Get marker color and create appropriate icon
    const markerColor = config.getColor(item);
    const markerIcon = iconType === 'development'
      ? createBasicProjectIcon(markerColor)
      : createColorIcon(markerColor);

    // AI : Create marker with default opacity
    const marker = L.marker([latLng.lat, latLng.lng], {
      icon: markerIcon,
      opacity: defaultOpacity,
    });

    // AI : Set up tooltip if provided
    if (config.getTooltip) {
      marker.bindTooltip(config.getTooltip(item), {
        permanent: false,
      });
    }

    // AI : Set up data attributes after marker is added to DOM
    marker.on('add', () => {
      const markerElement = marker.getElement();
      if (markerElement) {
        // AI : Add test ID if provided
        if (config.getTestId) {
          markerElement.setAttribute('data-testid', config.getTestId(item));
        }

        // AI : Add custom data attributes if provided
        if (config.getDataAttributes) {
          const attributes = config.getDataAttributes(item);
          Object.entries(attributes).forEach(([key, value]) => {
            markerElement.setAttribute(key, value);
          });
        }
      }
    });

    // AI : Prevent double-click zoom on markers
    marker.on('dblclick', (e) => {
      L.DomEvent.stopPropagation(e);
    });

    // AI : Hover event - increase opacity
    marker.on('mouseover', () => {
      // AI : If custom hover handler provided, let it handle opacity
      if (config.onMarkerHover) {
        config.onMarkerHover(marker, item, true);
      } else if (selectedMarker !== marker) {
        // AI : Default behavior: only increase opacity if not selected
        marker.setOpacity(hoverOpacity);
      }
    });

    // AI : Mouse out event - reset opacity (unless selected)
    marker.on('mouseout', () => {
      // AI : If custom hover handler provided, let it handle opacity
      if (config.onMarkerHover) {
        config.onMarkerHover(marker, item, false);
      } else if (selectedMarker !== marker) {
        // AI : Default behavior: only reset opacity if not selected
        marker.setOpacity(defaultOpacity);
      }
    });

    // AI : Click event
    if (config.onMarkerClick) {
      marker.on('click', async (e) => {
        // AI : Stop event propagation
        L.DomEvent.stopPropagation(e);

        // AI : Reset all markers to default opacity
        resetLayerMarkersOpacity(layer, defaultOpacity);

        // AI : Set this marker as selected
        marker.setOpacity(hoverOpacity);
        selectedMarker = marker;

        // AI : Call custom click handler
        await config.onMarkerClick!(marker, item);
      });
    }

    // AI : Store marker in map for easy lookup (if item has ID)
    if (item.id) {
      markers.set(item.id, marker);
    }

    // AI : Add marker to layer
    marker.addTo(layer);
  });

  return {
    layer,
    markers,
    selectedMarker,
  };
}
