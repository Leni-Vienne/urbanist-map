import { map } from "@/services/core/map";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { loadCityData } from "@/services/navigation/cityDataLoader";
import {
  processStandaloneMarkers,
  renderFullOverlays,
  renderMarkersOnly,
} from "@/services/navigation/cityRenderingCore";
import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
import { clearAllStandaloneProjectMarkers } from "@/services/map/standaloneProjectMarkers";
import type { OverlayData } from "@/types/index";
import type { StandaloneProject } from "@/utils/typeFactories";

/**
 * Load and render city data for navigation flows.
 * Called by city marker clicks, overlay navigation, and ProjectManager.
 * forceFullOverlays = true skips the zoom check and always renders full images.
 */
export async function loadAndRenderCityData(
  cityId: number,
  forceFullOverlays = false,
): Promise<{ overlays: OverlayData[]; projects: StandaloneProject[] }> {
  const { overlays, projects } = await loadCityData(cityId);

  // Always clear previous city's content before rendering the new city.
  // Without this, switching cities would leave old markers/images on the map.
  clearAllOverlays();
  clearAllStandaloneProjectMarkers();

  if (projects) {
    processStandaloneMarkers(projects, overlays);
  }

  if (overlays && overlays.length > 0) {
    const zoom = map.value.getZoom();
    const shouldRenderFullOverlays =
      forceFullOverlays || zoom >= getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS);

    if (shouldRenderFullOverlays) {
      // renderFullOverlays hydrates the store and handles image pruning
      // The async created markers will now be interactive natively
      renderFullOverlays(overlays);
    } else {
      renderMarkersOnly(overlays);
    }
  }

  return {
    overlays: overlays ?? [],
    projects: projects ?? [],
  };
}
