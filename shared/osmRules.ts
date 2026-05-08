/**
 * OSM property mapping rules for project tags
 * Shared between frontend (projectTags.ts) and backend (import-osm.ts)
 */

interface OsmRule {
  key: string;
  values?: string[];
  tag: string;
}

/**
 * Base OSM rules used for display and basic tag extraction
 * These rules cover the core transport and infrastructure types
 */
const BASE_OSM_RULES: OsmRule[] = [
  // Tram
  { key: "railway", values: ["tram"], tag: "tram" },
  { key: "route", values: ["tram"], tag: "tram" },

  // Light rail
  { key: "railway", values: ["light_rail"], tag: "light_rail" },
  { key: "route", values: ["light_rail"], tag: "light_rail" },

  // Rail (heavy rail, narrow gauge, monorail)
  { key: "railway", values: ["rail", "narrow_gauge", "monorail"], tag: "rail" },
  { key: "route", values: ["train", "railway"], tag: "rail" },

  // Subway / metro
  { key: "railway", values: ["subway"], tag: "subway" },
  { key: "route", values: ["subway"], tag: "subway" },

  // Bus
  { key: "route", values: ["bus", "trolleybus"], tag: "bus" },
  { key: "amenity", values: ["bus_station"], tag: "bus" },
  { key: "highway", values: ["bus_guideway"], tag: "bus" },

  // Bike
  { key: "route", values: ["bicycle", "mtb"], tag: "bike" },
  { key: "highway", values: ["cycleway"], tag: "bike" },
  { key: "bicycle", values: ["yes", "designated"], tag: "bike" },

  // Road
  {
    key: "highway",
    values: [
      "motorway",
      "trunk",
      "primary",
      "secondary",
      "tertiary",
      "residential",
      "unclassified",
    ],
    tag: "road",
  },
  { key: "route", values: ["road"], tag: "road" },

  // Waterway
  { key: "waterway", tag: "waterway" },
  { key: "natural", values: ["water", "bay", "strait"], tag: "waterway" },
  { key: "man_made", values: ["pier", "dam"], tag: "waterway" },

  // Park / green space
  {
    key: "leisure",
    values: ["park", "garden", "playground", "sports_centre", "recreation_ground"],
    tag: "park",
  },
  {
    key: "landuse",
    values: ["forest", "grass", "recreation_ground", "meadow", "greenfield"],
    tag: "park",
  },
  // Future use: a construction site whose target is a park
  {
    key: "construction",
    values: ["park", "garden", "playground", "recreation_ground"],
    tag: "park",
  },

  // Building
  { key: "building", tag: "building" },
  {
    key: "landuse",
    values: ["commercial", "residential", "retail", "industrial"],
    tag: "building",
  },
  // Future use: a construction site whose target is a building
  {
    key: "construction",
    values: ["apartments", "commercial", "office", "industrial", "retail", "house", "hotel"],
    tag: "building",
  },
];

/**
 * Extended OSM rules for import scripts
 * Includes construction/proposed detection and additional transport types
 */
export const EXTENDED_OSM_RULES: OsmRule[] = [
  // --- Tram ---
  { key: "railway", values: ["tram"], tag: "tram" },
  { key: "route", values: ["tram"], tag: "tram" },
  { key: "construction", values: ["tram"], tag: "tram" },
  { key: "proposed", values: ["tram"], tag: "tram" },
  { key: "transport_type", values: ["tram"], tag: "tram" },

  // --- Light rail ---
  { key: "railway", values: ["light_rail"], tag: "light_rail" },
  { key: "route", values: ["light_rail"], tag: "light_rail" },
  { key: "construction", values: ["light_rail"], tag: "light_rail" },
  { key: "proposed", values: ["light_rail"], tag: "light_rail" },
  { key: "transport_type", values: ["light_rail"], tag: "light_rail" },

  // --- Subway / Metro ---
  { key: "railway", values: ["subway"], tag: "subway" },
  { key: "route", values: ["subway"], tag: "subway" },
  { key: "construction", values: ["subway"], tag: "subway" },
  { key: "proposed", values: ["subway"], tag: "subway" },
  { key: "transport_type", values: ["subway"], tag: "subway" },

  // --- Rail (heavy rail, narrow gauge, monorail) ---
  { key: "railway", values: ["rail", "narrow_gauge", "monorail"], tag: "rail" },
  { key: "route", values: ["train", "railway"], tag: "rail" },
  { key: "construction", values: ["rail", "narrow_gauge", "monorail"], tag: "rail" },
  { key: "proposed", values: ["rail", "narrow_gauge", "monorail"], tag: "rail" },
  {
    key: "transport_type",
    values: ["rail", "narrow_gauge", "monorail", "miniature"],
    tag: "rail",
  },

  // --- Cable car / aerial / funicular ---
  {
    key: "aerialway",
    values: ["cable_car", "gondola", "funicular", "chair_lift", "mixed_lift", "drag_lift"],
    tag: "cable_car",
  },
  { key: "route", values: ["funicular"], tag: "cable_car" },
  {
    key: "construction",
    values: ["cable_car", "gondola", "funicular", "chair_lift"],
    tag: "cable_car",
  },
  {
    key: "proposed",
    values: ["cable_car", "gondola", "funicular", "chair_lift"],
    tag: "cable_car",
  },
  { key: "transport_type", values: ["cable_car", "gondola", "funicular"], tag: "cable_car" },

  // --- Bus / BRT ---
  { key: "construction", values: ["bus", "trolleybus", "bus_guideway"], tag: "bus" },
  { key: "proposed", values: ["bus", "trolleybus", "bus_guideway"], tag: "bus" },
  { key: "route", values: ["bus", "trolleybus"], tag: "bus" },
  { key: "amenity", values: ["bus_station"], tag: "bus" },
  { key: "highway", values: ["bus_guideway"], tag: "bus" },
  { key: "transport_type", values: ["bus"], tag: "bus" },

  // --- Cycling / bike ---
  { key: "construction", values: ["bicycle", "cycleway"], tag: "bike" },
  { key: "proposed", values: ["bicycle", "cycleway"], tag: "bike" },
  { key: "route", values: ["bicycle", "mtb"], tag: "bike" },
  { key: "highway", values: ["cycleway"], tag: "bike" },
  { key: "bicycle", values: ["yes", "designated"], tag: "bike" },
  { key: "transport_type", values: ["bike"], tag: "bike" },

  // --- Pedestrian ---
  { key: "construction", values: ["pedestrian", "footway", "path"], tag: "pedestrian" },
  { key: "proposed", values: ["pedestrian", "footway", "path"], tag: "pedestrian" },
  { key: "highway", values: ["pedestrian", "footway", "path"], tag: "pedestrian" },
  { key: "transport_type", values: ["pedestrian"], tag: "pedestrian" },

  // --- Road ---
  {
    key: "highway",
    values: [
      "motorway",
      "trunk",
      "primary",
      "secondary",
      "tertiary",
      "residential",
      "unclassified",
    ],
    tag: "road",
  },
  { key: "route", values: ["road"], tag: "road" },
  { key: "transport_type", values: ["road"], tag: "road" },

  // --- Waterway ---
  { key: "waterway", tag: "waterway" },
  { key: "natural", values: ["water", "bay", "strait"], tag: "waterway" },
  { key: "man_made", values: ["pier", "dam"], tag: "waterway" },
  { key: "transport_type", values: ["waterway"], tag: "waterway" },

  // --- Park / green ---
  {
    key: "leisure",
    values: ["park", "garden", "playground", "sports_centre", "recreation_ground"],
    tag: "park",
  },
  {
    key: "landuse",
    values: ["forest", "grass", "recreation_ground", "meadow", "greenfield"],
    tag: "park",
  },
  {
    key: "construction",
    values: ["park", "garden", "playground", "recreation_ground"],
    tag: "park",
  },
  { key: "proposed", values: ["park", "garden", "playground", "recreation_ground"], tag: "park" },

  // --- Building / urban development ---
  { key: "building", tag: "building" },
  {
    key: "landuse",
    values: ["commercial", "residential", "retail", "industrial"],
    tag: "building",
  },
  {
    key: "construction",
    values: ["apartments", "commercial", "office", "industrial", "retail", "house", "hotel"],
    tag: "building",
  },
  {
    key: "proposed",
    values: ["apartments", "commercial", "office", "industrial", "retail", "house", "hotel"],
    tag: "building",
  },
];

export function extractTagsFromOsmProperties(
  featureProperties: Record<string, unknown>[],
): string[] {
  const found = new Set<string>();

  for (const props of featureProperties) {
    for (const rule of BASE_OSM_RULES) {
      const val = props[rule.key];
      if (typeof val === "string" || typeof val === "number") {
        const strVal = String(val);
        if (!rule.values || rule.values.includes(strVal)) {
          found.add(rule.tag);
        }
      }
    }
  }

  return [...found];
}
