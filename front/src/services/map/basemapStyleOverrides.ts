import type { Map as MaplibreMap } from "maplibre-gl";

// Gray shades for road types, replacing Liberty's yellow/orange major roads.
// Minor roads and paths are already white/gray in Liberty and are left unchanged.
const ROAD_COLOR_OVERRIDES: Record<string, string> = {
  motorway: "#c0bfbf",
  trunk: "#d0cfcf",
  primary: "#e0dfdf",
  secondary: "#ebebeb",
  tertiary: "#f0efef",
};

// Casing (outline) colors, slightly darker than the fill
const ROAD_CASING_OVERRIDES: Record<string, string> = {
  motorway: "#a8a8a8",
  trunk: "#b8b8b8",
  primary: "#cccccc",
  secondary: "#d8d8d8",
  tertiary: "#dedede",
};

/**
 * Overrides Liberty basemap road colors to a neutral gray palette.
 * Only runs when the plan (vector) style is active, satellite styles have no road layers.
 * Matches Liberty layer IDs like "road_trunk", "road_primary_casing", "tunnel_motorway", etc.
 */
export function applyPlanStyleRoadOverrides(mlMap: MaplibreMap): void {
  const layers = mlMap.getStyle().layers;

  for (const layer of layers) {
    if (layer.type !== "line") continue;

    const id = layer.id;
    if (!id.startsWith("road") && !id.startsWith("tunnel") && !id.startsWith("bridge")) continue;

    const isCasing = id.includes("casing") || id.includes("outline") || id.includes("border");

    for (const [roadType, color] of Object.entries(
      isCasing ? ROAD_CASING_OVERRIDES : ROAD_COLOR_OVERRIDES,
    )) {
      if (id.includes(roadType)) {
        mlMap.setPaintProperty(id, "line-color", color);
        break;
      }
    }
  }
}

/**
 * Adds an atmospheric sky so the area above the horizon at high pitch shows a
 * sky gradient instead of plain white. Tuned to a light haze matching the basemap.
 */
export function applySky(mlMap: MaplibreMap): void {
  mlMap.setSky({
    "sky-color": "#a7c7e7",
    "sky-horizon-blend": 0.8,
    "horizon-color": "#eef2f5",
    "horizon-fog-blend": 0.6,
    "fog-color": "#eef2f5",
    "fog-ground-blend": 0.0,
    // Fade the sky out as we zoom in so the 3D buildings keep their flat backdrop up close.
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 1, 14, 0],
  });
}

/**
 * Applies overrides to the Liberty basemap's railway styling to visually
 * differentiate it from our tram project geometries.
 * Makes existing railways orange and semi-transparent.
 */
export function applyRailStyleOverrides(mlMap: MaplibreMap): void {
  const layers = mlMap.getStyle().layers;

  for (const layer of layers) {
    if (layer.type !== "line") continue;

    const id = layer.id;
    if (id.includes("road_major_rail") || id.includes("bridge_major_rail")) {
      mlMap.setPaintProperty(id, "line-color", "#f97316");
      mlMap.setPaintProperty(id, "line-opacity", 0.7);
    }
    if (id.includes("tunnel_major_rail")) {
      mlMap.setPaintProperty(id, "line-color", "#f97316");
      mlMap.setPaintProperty(id, "line-opacity", 0.5);
    }
  }
}
