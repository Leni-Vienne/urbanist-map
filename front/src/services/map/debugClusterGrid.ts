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
const LABEL_LAYER_ID = "debug-cluster-grid-labels";

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
  const labels: GeoJSON.Feature[] = [];

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
      // Cell index label at each cell center
      for (let cx = 0; cx < numCells; cx += 1) {
        for (let cy = 0; cy < numCells; cy += 1) {
          const [lng, lat] = tilePxToLngLat(
            tx,
            ty,
            cx * cellSize + cellSize / 2,
            cy * cellSize + cellSize / 2,
            z,
          );
          labels.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lng, lat] },
            properties: { label: `${tx},${ty} [${cx},${cy}]` },
          });
        }
      }
    }
  }

  return { type: "FeatureCollection", features: [...lines, ...labels] };
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

let _active = false;
let _mlMap: MaplibreMap | null = null;
const _refresh = () => {
  if (_mlMap) refreshGrid(_mlMap);
};

export function toggleClusterGrid(mlMap?: MaplibreMap): void {
  if (mlMap) _mlMap = mlMap;
  if (!_mlMap) {
    console.warn("toggleClusterGrid: no mlMap provided and none cached");
    return;
  }

  if (_active) {
    _mlMap.off("moveend", _refresh);
    _mlMap.off("zoomend", _refresh);
    if (_mlMap.getLayer(LABEL_LAYER_ID)) _mlMap.removeLayer(LABEL_LAYER_ID);
    if (_mlMap.getLayer(LAYER_ID)) _mlMap.removeLayer(LAYER_ID);
    if (_mlMap.getSource(SOURCE_ID)) _mlMap.removeSource(SOURCE_ID);
    _active = false;
    console.log("Cluster grid hidden");
  } else {
    addLayers(_mlMap);
    _mlMap.on("moveend", _refresh);
    _mlMap.on("zoomend", _refresh);
    _active = true;
    console.log(
      `Cluster grid shown, cell_size=${getGridCellSizeForTileZoom(Math.floor(_mlMap.getZoom()))}`,
    );
  }
}
