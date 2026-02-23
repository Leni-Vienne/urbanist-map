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
import { removeOverlayMarkers, renderOverlayMarkersFromData } from "@/services/map/cityOverlays";
import { clearAllOverlays } from "@/services/overlay/overlayLifecycle";
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

  if (projects) {
    processStandaloneMarkers(projects, overlays);
  }

  // AI : Always clear previous city's overlay content (images + markers) before rendering.
  // AI : Without this, switching to a city with no overlays would leave the old markers on the map.
  clearAllOverlays();
  removeOverlayMarkers();

  if (overlays && overlays.length > 0) {
    const zoom = map.value.getZoom();
    const shouldRenderFullOverlays = forceFullOverlays || zoom >= MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS;

    if (shouldRenderFullOverlays) {
      // AI : Show overlay dot markers immediately while images load in background.
      // AI : renderFullOverlays' rAF will promote these to standalone markers,
      // AI : and onOverlayFullyLoaded will wire them to the overlay objects.
      renderOverlayMarkersFromData(overlays);
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
