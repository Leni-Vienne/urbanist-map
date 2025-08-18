import { isEditMode } from '@composables/overlay/useOverlay';
import { getConstructionMarkerColor } from '@composables/map/useCityMarkers';
import type { OverlayObject, CDNOverlayData, MarkerColor } from '@types';

/**
 * AI : Centralized function to determine marker color based on overlay state
 * This replaces the duplicated logic in multiple files
 */
export function getOverlayMarkerColor(
  overlayData: OverlayObject | CDNOverlayData,
  mode: 'edit' | 'view' = isEditMode.value ? 'edit' : 'view'
): MarkerColor {

  if (mode === 'edit') {
    // AI : Edit mode - show different colors based on overlay state

    // AI : Check if this is a replacement overlay first (highest priority)
    if (overlayData.replacesOverlayId) {
      return 'violet';
    }

    // AI : Check if overlay was loaded from CDN or has been saved to backend
    const isRemoteOverlay = overlayData.project !== undefined ||
      ('savedToBackend' in overlayData && overlayData.savedToBackend === true);

    // AI : Check if overlay has been modified locally
    const hasBeenModified = 'isModified' in overlayData ? overlayData.isModified : false;

    if (isRemoteOverlay && !hasBeenModified) {
      // AI : Remote overlay, not modified = green
      return 'green';
    } else if (isRemoteOverlay && hasBeenModified) {
      // AI : Remote overlay, modified locally = orange
      return 'orange';
    } else if (!isRemoteOverlay && hasBeenModified) {
      // AI : Local overlay with changes = red
      return 'red';
    } else {
      // AI : New overlay, no changes = blue
      return 'blue';
    }
  } else {
    // AI : View mode - use construction timeline colors
    let startDate: string | Date | null | undefined = null;
    let endDate: string | Date | null | undefined = null;

    if (overlayData.project) {
      startDate = overlayData.project.startDate;
      endDate = overlayData.project.endDate;
    } else if ('startDate' in overlayData || 'endDate' in overlayData) {
      startDate = (overlayData as any).startDate;
      endDate = (overlayData as any).endDate;
    }

    return getConstructionMarkerColor(startDate, endDate);
  }
}
