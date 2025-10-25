// AI : Overlay marker update functions extracted to break circular dependency
import { createColorIcon } from '@composables/ui/markerIcons';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import type { OverlayObject } from '@types';
import type { ShallowRef } from 'vue';

/**
 * AI : Update overlay markers colors for existing markers based on current mode
 * @param overlays - Reference to overlays object
 * @param specificOverlayId - Optional overlay ID to update only one overlay (optimization)
 */
export function updateOverlayMarkersColors(
  overlays: ShallowRef<Record<string, OverlayObject>>,
  specificOverlayId?: string
): void {
  if (!overlays?.value) return;

  const overlayStore = useOverlayStore();

  // AI : If specific overlay ID provided, only update that one
  if (specificOverlayId) {
    const overlayObject = overlays.value[specificOverlayId];
    if (overlayObject?.marker) {
      const markerColor = getOverlayMarkerColor(overlayObject, overlayStore.mode);
      const colorIcon = createColorIcon(markerColor);
      overlayObject.marker.setIcon(colorIcon);
    }
    return;
  }

  // AI : Otherwise, iterate through all overlay objects that have markers
  Object.values(overlays.value).forEach((overlayObject: OverlayObject) => {
    if (overlayObject?.marker) {
      // AI : Update marker color based on current mode and overlay state
      const markerColor = getOverlayMarkerColor(overlayObject, overlayStore.mode);
      const colorIcon = createColorIcon(markerColor);
      overlayObject.marker.setIcon(colorIcon);
    }
  });
}
