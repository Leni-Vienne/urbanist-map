/**
 * Debug utility: renders the backend clustering grid on the map as a MapLibre GeoJSON layer.
 *
 * The grid is NOT the MapLibre/MVT tile grid. It is the logical clustering grid defined in
 * tiles.sql: each tile is divided into cells of `cell_size` MVT units (out of 4096).
 * One cell = one potential cluster point on the points layer.
 *
 * Usage from the browser console:
 *   import('@/services/map/debugClusterGrid').then(m => m.toggleClusterGrid())
 * Or call toggleClusterGrid() from anywhere that has access to the mlMap instance.
 */

import type { Map as MaplibreMap, GeoJSONSource } from "maplibre-gl";
import { getGridCellSizeForTileZoom, tilePxToLngLat } from "@/services/map/tileGrid";

const SOURCE_ID = "debug-cluster-grid";
const LAYER_ID = "debug-cluster-grid-lines";

function buildGridGeoJSON(mlMap: MaplibreMap): GeoJSON.FeatureCollection {
  // Use the integer tile zoom to match the MVT grid used by the backend.
  const tileZoom = Math.floor(mlMap.getZoom());
  const cellSize = getGridCellSizeForTileZoom(tileZoom);
  const numCells = Math.ceil(4096 / cellSize); // cells per tile axis

  const bounds = mlMap.getBounds();
  const z = tileZoom;
  const n = 2 ** z;

  const minTileX = Math.floor(((bounds.getWest() + 180) / 360) * n);
  const maxTileX = Math.floor(((bounds.getEast() + 180) / 360) * n);

  const latToTileY = (lat: number) => {
    const latRad = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  };
  const minTileY = latToTileY(bounds.getNorth());
  const maxTileY = latToTileY(bounds.getSouth());

  const lines: GeoJSON.Feature[] = [];

  for (let tx = minTileX - 1; tx <= maxTileX + 1; tx += 1) {
    for (let ty = minTileY - 1; ty <= maxTileY + 1; ty += 1) {
      for (let cx = 0; cx <= numCells; cx += 1) {
        const px = cx * cellSize;
        const top = tilePxToLngLat(tx, ty, px, 0, z);
        const bottom = tilePxToLngLat(tx, ty, px, 4096, z);
        lines.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [top, bottom] },
          properties: {},
        });
      }
      for (let cy = 0; cy <= numCells; cy += 1) {
        const py = cy * cellSize;
        const left = tilePxToLngLat(tx, ty, 0, py, z);
        const right = tilePxToLngLat(tx, ty, 4096, py, z);
        lines.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [left, right] },
          properties: {},
        });
      }
    }
  }

  return { type: "FeatureCollection", features: lines };
}

function addLayers(mlMap: MaplibreMap) {
  mlMap.addSource(SOURCE_ID, { type: "geojson", data: buildGridGeoJSON(mlMap) });

  mlMap.addLayer({
    id: LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": "#ff00ff",
      "line-width": 1,
      "line-opacity": 0.6,
    },
  });
}

function refreshGrid(mlMap: MaplibreMap) {
  const source = mlMap.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (source) source.setData(buildGridGeoJSON(mlMap));
}

let isActive = false;
let debugMlMap: MaplibreMap | null = null;
function refreshGridCallback(): void {
  if (debugMlMap) refreshGrid(debugMlMap);
}

export function toggleClusterGrid(mlMap?: MaplibreMap): void {
  if (mlMap) debugMlMap = mlMap;
  if (!debugMlMap) {
    console.warn("toggleClusterGrid: no mlMap provided and none cached");
    return;
  }

  if (isActive) {
    debugMlMap.off("moveend", refreshGridCallback);
    debugMlMap.off("zoomend", refreshGridCallback);
    if (debugMlMap.getLayer(LAYER_ID)) debugMlMap.removeLayer(LAYER_ID);
    if (debugMlMap.getSource(SOURCE_ID)) debugMlMap.removeSource(SOURCE_ID);
    isActive = false;
    console.log("Cluster grid hidden");
  } else {
    addLayers(debugMlMap);
    debugMlMap.on("moveend", refreshGridCallback);
    debugMlMap.on("zoomend", refreshGridCallback);
    isActive = true;
    console.log(
      `Cluster grid shown, cell_size=${getGridCellSizeForTileZoom(Math.floor(debugMlMap.getZoom()))}`,
    );
  }
}
