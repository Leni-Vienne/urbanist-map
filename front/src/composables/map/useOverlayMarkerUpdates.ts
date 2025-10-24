// AI : Overlay marker update functions extracted to break circular dependency
import { createColorIcon } from '@composables/ui/markerIcons';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import { useOverlayStore } from '@stores/pinia/overlayStore';
import type { OverlayObject } from '@types';
import type { ShallowRef } from 'vue';

/**
 * AI : Update overlay markers colors for existing markers based on current mode
 */
export function updateOverlayMarkersColors(
  overlays: ShallowRef<Record<string, OverlayObject>>
): void {
  if (!overlays?.value) return;

  const overlayStore = useOverlayStore();

  // AI : Iterate through all overlay objects that have markers
  Object.values(overlays.value).forEach((overlayObject: OverlayObject) => {
    if (overlayObject?.marker) {
      // AI : Update marker color based on current mode and overlay state
      const markerColor = getOverlayMarkerColor(overlayObject, overlayStore.mode);
      const colorIcon = createColorIcon(markerColor);
      overlayObject.marker.setIcon(colorIcon);
    }
  });
}
