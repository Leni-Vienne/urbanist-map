// AI : Overlay marker update functions extracted to break circular dependency
import { createColorIcon } from '@composables/ui/markerIcons';
import { getOverlayMarkerColor } from '@composables/overlay/useOverlayMarkerColors';
import type { OverlayObject } from '@types';
import type { Ref, ShallowRef } from 'vue';

/**
 * AI : Update overlay markers colors for existing markers
 */
export function updateOverlayMarkersColors(
  overlays: ShallowRef<Record<string, OverlayObject>>,
  isEditMode: Ref<boolean>
): void {
  if (!overlays?.value) return;

  // AI : Iterate through all overlay objects that have markers
  Object.values(overlays.value).forEach((overlayObject: OverlayObject) => {
    if (overlayObject?.marker) {
      // AI : Update marker color based on current mode and overlay state
      const markerColor = getOverlayMarkerColor(overlayObject, isEditMode.value ? 'edit' : 'view');
      const colorIcon = createColorIcon(markerColor);
      overlayObject.marker.setIcon(colorIcon);
    }
  });
}
