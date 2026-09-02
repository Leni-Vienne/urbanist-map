import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { computed, watch } from "vue";
import { getMapOrNull, onStyleSwitch, type StyleSwitchPhase } from "@/services/core/map";
import { mapArea, type MapArea } from "@/services/feed/latestContributions";
import { useUiStore } from "@/stores/uiStore";

// The area filter is picked from the feed's filter surface, which mobile hosts in a tab of its own.
const isAreaFilterOnScreen = computed(() => {
  const tab = useUiStore().activeTab;
  return tab === "explore" || tab === "filter";
});

const SOURCE_ID = "map-area-filter";
const SCRIM_LAYER_ID = "map-area-filter-scrim";
const CASING_LAYER_ID = "map-area-filter-casing";
const OUTLINE_LAYER_ID = "map-area-filter-outline";

// Web Mercator's latitude limit. The scrim's outer ring reaches it so no strip of map is left
// undimmed at the poles.
const MAX_MERCATOR_LATITUDE = 85.051129;

function clampLatitude(value: number): number {
  return Math.min(Math.max(value, -MAX_MERCATOR_LATITUDE), MAX_MERCATOR_LATITUDE);
}

function rectangleRing(west: number, south: number, east: number, north: number): Position[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

// A filtered area crossing the antimeridian has west > east, which no single rectangle can express;
// it becomes one rectangle per side of the 180th meridian.
function areaRings(area: MapArea): Position[][] {
  const south = clampLatitude(area.south);
  const north = clampLatitude(area.north);
  if (area.west > area.east) {
    return [
      rectangleRing(area.west, south, 180, north),
      rectangleRing(-180, south, area.east, north),
    ];
  }
  return [rectangleRing(area.west, south, area.east, north)];
}

// The scrim is the whole world with the filtered area punched out as holes; the outline traces the
// area alone. Both live in one source, told apart by `role` so each layer draws only its own.
function buildAreaFeatures(area: MapArea): FeatureCollection {
  const rings = areaRings(area);

  const scrim: Feature<Polygon> = {
    type: "Feature",
    properties: { role: "scrim" },
    geometry: {
      type: "Polygon",
      coordinates: [
        rectangleRing(-180, -MAX_MERCATOR_LATITUDE, 180, MAX_MERCATOR_LATITUDE),
        ...rings,
      ],
    },
  };

  const outline: Feature<MultiPolygon> = {
    type: "Feature",
    properties: { role: "outline" },
    geometry: { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) },
  };

  return { type: "FeatureCollection", features: [scrim, outline] };
}

// The project geometry marks the bottom of the data layers. Anchoring there keeps the scrim on the
// basemap alone, so contributions stay legible however dim the surroundings get.
function dataLayersBottomId(mlMap: MaplibreMap): string | undefined {
  return mlMap.getStyle().layers.find((layer) => layer.id.startsWith("project-shapes"))?.id;
}

// A light stroke over a white casing so the boundary reads on the plan, dark and satellite
// basemaps alike, dashed so it does not invite dragging: the area is not editable in place.
function addAreaLayers(mlMap: MaplibreMap, data: FeatureCollection): void {
  mlMap.addSource(SOURCE_ID, { type: "geojson", data });

  mlMap.addLayer(
    {
      id: SCRIM_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      filter: ["==", ["get", "role"], "scrim"],
      paint: { "fill-color": "#000000", "fill-opacity": 0.18 },
    },
    dataLayersBottomId(mlMap),
  );

  mlMap.addLayer({
    id: CASING_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    filter: ["==", ["get", "role"], "outline"],
    paint: { "line-color": "#ffffff", "line-width": 3.5, "line-opacity": 0.5 },
  });

  mlMap.addLayer({
    id: OUTLINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    filter: ["==", ["get", "role"], "outline"],
    paint: {
      "line-color": "#374151",
      "line-width": 1.5,
      "line-dasharray": [3, 2],
      "line-opacity": 0.9,
    },
  });
}

function removeAreaLayers(mlMap: MaplibreMap): void {
  for (const layerId of [OUTLINE_LAYER_ID, CASING_LAYER_ID, SCRIM_LAYER_ID]) {
    if (mlMap.getLayer(layerId)) mlMap.removeLayer(layerId);
  }
  if (mlMap.getSource(SOURCE_ID)) mlMap.removeSource(SOURCE_ID);
}

/**
 * Draw the frozen bounds of the map-area filter, or clear them. Reads the map rather than a cached
 * flag, so it also rebuilds the layers a style swap destroyed.
 */
export function syncMapAreaOutline(): void {
  const mlMap = getMapOrNull();
  if (!mlMap?.getSource("project-sources")) return;

  const area = isAreaFilterOnScreen.value ? mapArea.value : null;
  if (!area) {
    removeAreaLayers(mlMap);
    return;
  }

  const data = buildAreaFeatures(area);
  const source = mlMap.getSource<GeoJSONSource>(SOURCE_ID);
  if (source) {
    void source.setData(data);
    return;
  }
  addAreaLayers(mlMap, data);
}

function reattachAfterStyleSwitch(phase: StyleSwitchPhase): void {
  if (phase !== "after") return;
  syncMapAreaOutline();
}

/** Keep the drawn bounds in step with the filter and with the tab that owns it. */
export function watchMapAreaOutline(): () => void {
  const stopAreaWatch = watch([mapArea, isAreaFilterOnScreen], syncMapAreaOutline);
  const stopStyleSwitchWatch = onStyleSwitch(reattachAfterStyleSwitch);

  return function stopMapAreaOutline(): void {
    stopStyleSwitchWatch();
    stopAreaWatch();
  };
}
