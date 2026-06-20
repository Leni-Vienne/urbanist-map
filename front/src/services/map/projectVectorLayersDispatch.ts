import type { Map as MaplibreMap } from "maplibre-gl";
import { mapLayerMode } from "@/composables/core/useMapLayerMode";
import * as defaultLayers from "@/services/map/projectVectorLayers";
import * as altLayers from "@/services/map/projectVectorLayersAlt";

// Single entry point for the project vector layers. The active style is fixed for the session
// (switching the layer mode reloads the page), so consumers import from here instead of either
// implementation directly. projectVectorLayers.ts is the default style; projectVectorLayersAlt.ts is
// the alternative one, free to render its layers differently.
function activeLayers(): typeof defaultLayers {
  return mapLayerMode.value === "alternative" ? altLayers : defaultLayers;
}

export function addProjectDataToMlMap(mlMap: MaplibreMap): void {
  activeLayers().addProjectDataToMlMap(mlMap);
}

export function registerHybridInteractionHandlers(mlMapGetter: () => MaplibreMap | null): void {
  activeLayers().registerHybridInteractionHandlers(mlMapGetter);
}

export function applyTagFiltersToVectorLayers(mlMap: MaplibreMap): void {
  activeLayers().applyTagFiltersToVectorLayers(mlMap);
}

// The set of queryable project layer IDs for the active style. Fixed at module load since the mode
// only changes via a page reload.
export const VECTOR_QUERY_LAYERS = activeLayers().VECTOR_QUERY_LAYERS;
