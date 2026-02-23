// AI : City data rendering for navigation flows (city marker clicks, country navigation).
// AI : Thin orchestration layer: delegates data loading to cityDataLoader
// AI : and all rendering to cityRenderingCore.
import { map } from "@/services/core/map";
import { MAP_CONFIG } from "@/constants/mapConstants";
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
 * AI : Load and render city data for navigation flows.
 * AI : Called by city marker clicks, overlay navigation, and ProjectManager.
 * AI : forceFullOverlays = true skips the zoom check and always renders full images.
 */
export async function loadAndRenderCityData(
  cityId: number,
  forceFullOverlays = false,
): Promise<{ overlays: OverlayData[]; projects: StandaloneProject[] }> {
  const { overlays, projects } = await loadCityData(cityId);

  // AI : Always clear previous city's content before rendering the new city.
  // AI : Without this, switching cities would leave old markers/images on the map.
  clearAllOverlays();
  clearAllStandaloneProjectMarkers();

  if (projects) {
    processStandaloneMarkers(projects, overlays);
  }

  if (overlays && overlays.length > 0) {
    const zoom = map.value.getZoom();
    const shouldRenderFullOverlays = forceFullOverlays || zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;

    if (shouldRenderFullOverlays) {
      // AI : renderFullOverlays hydrates the store and handles image pruning
      // AI : The async created markers will now be interactive natively
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
