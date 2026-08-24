import type { JsonObject } from "./json";

interface OsmRule {
  key: string;
  values?: string[];
  tag: string;
}

/**
 * Plain OSM keys that describe what currently stands on a site. On a redevelopment
 * site, where the lifecycle signal only comes from proposed:/planned:/construction:
 * namespaced keys (e.g. an aerodrome with planned:landuse=residential), these keys
 * describe the feature being replaced, so tag rules keyed on them must be skipped.
 */
export const PRESENT_STATE_OSM_KEYS = new Set([
  "aeroway",
  "railway",
  "highway",
  "waterway",
  "aerialway",
  "leisure",
  "landuse",
  "natural",
  "man_made",
  "amenity",
  "building",
  "route",
  "bicycle",
]);

const LIFECYCLE_VALUES = new Set(["proposed", "planned", "construction"]);
const LIFECYCLE_PREFIX_RE = /^(?:proposed|planned|construction):/;
const PLAIN_LIFECYCLE_KEYS = ["construction", "proposed", "planned"];
const NON_DESCRIPTIVE_CONSTRUCTION_VALUES = new Set([
  "",
  "yes",
  "no",
  "construction",
  "proposed",
  "planned",
]);

/**
 * True when the feature is an existing site whose project is expressed only through
 * lifecycle-namespaced keys. When the lifecycle signal sits on plain keys instead
 * (building=construction, railway=proposed, proposed=yes), the plain tags describe
 * the future feature and remain eligible for tag rules.
 */
export function isRedevelopmentSite(props: JsonObject): boolean {
  if (!Object.keys(props).some(hasLifecyclePrefix)) return false;
  for (const key of PLAIN_LIFECYCLE_KEYS) {
    const val = props[key];
    if (typeof val === "string" && val !== "" && val !== "no") return false;
  }
  for (const key of PRESENT_STATE_OSM_KEYS) {
    const val = props[key];
    if (typeof val === "string" && LIFECYCLE_VALUES.has(val)) return false;
  }
  return true;
}

function hasLifecyclePrefix(key: string): boolean {
  return LIFECYCLE_PREFIX_RE.test(key);
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
  { key: "route", values: ["train", "railway", "monorail"], tag: "rail" },

  // Subway / metro
  { key: "railway", values: ["subway"], tag: "subway" },
  { key: "route", values: ["subway"], tag: "subway" },

  // Cable car / aerial lifts
  {
    key: "aerialway",
    values: ["cable_car", "gondola", "funicular", "chair_lift", "mixed_lift", "drag_lift"],
    tag: "cable_car",
  },
  { key: "route", values: ["funicular"], tag: "cable_car" },

  // Bus
  { key: "route", values: ["bus", "trolleybus"], tag: "bus" },
  { key: "amenity", values: ["bus_station"], tag: "bus" },
  { key: "highway", values: ["bus_guideway", "busway"], tag: "bus" },

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

  // Pedestrian
  { key: "highway", values: ["pedestrian", "footway", "path"], tag: "pedestrian" },

  // Airport
  {
    key: "aeroway",
    values: ["runway", "taxiway", "apron", "terminal", "aerodrome"],
    tag: "airport",
  },

  // Waterway
  { key: "waterway", tag: "waterway" },
  { key: "natural", values: ["water", "bay", "strait"], tag: "waterway" },
  { key: "man_made", values: ["pier", "dam"], tag: "waterway" },
  { key: "leisure", values: ["marina"], tag: "waterway" },

  // Park / green space
  {
    key: "leisure",
    values: [
      "park",
      "garden",
      "playground",
      "sports_centre",
      "recreation_ground",
      "stadium",
      "pitch",
      "golf_course",
    ],
    tag: "park",
  },
  {
    key: "landuse",
    values: ["forest", "grass", "recreation_ground", "meadow", "village_green"],
    tag: "park",
  },
  // Future use: a construction site whose target is a park
  {
    key: "construction",
    values: [
      "park",
      "garden",
      "playground",
      "recreation_ground",
      "stadium",
      "pitch",
      "golf_course",
    ],
    tag: "park",
  },

  // Coarse building use category derived by the areal extract script. Placed before the
  // generic building rules so the category tag comes first and drives display color.
  { key: "building_category", values: ["residential"], tag: "residential" },
  { key: "building_category", values: ["commercial"], tag: "commercial" },
  { key: "building_category", values: ["retail"], tag: "retail" },
  { key: "building_category", values: ["office"], tag: "office" },
  { key: "building_category", values: ["industrial"], tag: "industrial" },

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

  // Namespaced building tagging schemes that lack a plain building= key still denote a building.
  { key: "proposed:building", tag: "building" },
  { key: "construction:building", tag: "building" },
  { key: "planned:building", tag: "building" },

  // Namespaced landuse on redevelopment sites: the future use is a development.
  {
    key: "proposed:landuse",
    values: ["commercial", "residential", "retail", "industrial"],
    tag: "building",
  },
  {
    key: "planned:landuse",
    values: ["commercial", "residential", "retail", "industrial"],
    tag: "building",
  },
  {
    key: "construction:landuse",
    values: ["commercial", "residential", "retail", "industrial"],
    tag: "building",
  },
];

/**
 * transport_type is computed by the extract scripts (linear: canonical transport value,
 * areal: "park"/"building") and is the most accurate signal, so these rules come first:
 * tags are collected into an insertion-ordered Set and the first tag drives display.
 */
const TRANSPORT_TYPE_RULES: OsmRule[] = [
  { key: "transport_type", values: ["tram"], tag: "tram" },
  { key: "transport_type", values: ["light_rail"], tag: "light_rail" },
  { key: "transport_type", values: ["subway"], tag: "subway" },
  {
    key: "transport_type",
    values: ["rail", "narrow_gauge", "monorail", "miniature"],
    tag: "rail",
  },
  { key: "transport_type", values: ["cable_car", "gondola", "funicular"], tag: "cable_car" },
  { key: "transport_type", values: ["bus"], tag: "bus" },
  { key: "transport_type", values: ["bike"], tag: "bike" },
  { key: "transport_type", values: ["pedestrian"], tag: "pedestrian" },
  { key: "transport_type", values: ["road"], tag: "road" },
  { key: "transport_type", values: ["airport"], tag: "airport" },
  { key: "transport_type", values: ["waterway"], tag: "waterway" },
  { key: "transport_type", values: ["park"], tag: "park" },
];

/**
 * Plain construction=/proposed= keys whose value names the future feature.
 * Import-only: BASE keeps just the park and building variants of these.
 */
const LIFECYCLE_VALUE_RULES: OsmRule[] = [
  { key: "construction", values: ["tram"], tag: "tram" },
  { key: "proposed", values: ["tram"], tag: "tram" },
  { key: "construction", values: ["light_rail"], tag: "light_rail" },
  { key: "proposed", values: ["light_rail"], tag: "light_rail" },
  { key: "construction", values: ["subway"], tag: "subway" },
  { key: "proposed", values: ["subway"], tag: "subway" },
  { key: "construction", values: ["rail", "narrow_gauge", "monorail"], tag: "rail" },
  { key: "proposed", values: ["rail", "narrow_gauge", "monorail"], tag: "rail" },
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
  { key: "construction", values: ["bus", "trolleybus", "bus_guideway", "busway"], tag: "bus" },
  { key: "proposed", values: ["bus", "trolleybus", "bus_guideway", "busway"], tag: "bus" },
  { key: "construction", values: ["bicycle", "cycleway"], tag: "bike" },
  { key: "proposed", values: ["bicycle", "cycleway"], tag: "bike" },
  { key: "construction", values: ["pedestrian", "footway", "path"], tag: "pedestrian" },
  { key: "proposed", values: ["pedestrian", "footway", "path"], tag: "pedestrian" },
  { key: "construction", values: ["runway", "taxiway"], tag: "airport" },
  { key: "proposed", values: ["runway", "taxiway"], tag: "airport" },
  {
    key: "proposed",
    values: [
      "park",
      "garden",
      "playground",
      "recreation_ground",
      "stadium",
      "pitch",
      "golf_course",
    ],
    tag: "park",
  },
  {
    key: "proposed",
    values: ["apartments", "commercial", "office", "industrial", "retail", "house", "hotel"],
    tag: "building",
  },
];

/**
 * Extended OSM rules for import scripts
 * Includes construction/proposed detection and additional transport types
 */
export const EXTENDED_OSM_RULES: OsmRule[] = [
  ...TRANSPORT_TYPE_RULES,
  ...BASE_OSM_RULES,
  ...LIFECYCLE_VALUE_RULES,
];

export function hasConstructionSignal(props: JsonObject): boolean {
  if (props.landuse === "construction") return true;
  const construction = props.construction;
  return (
    typeof construction === "string" &&
    construction.trim() !== "" &&
    construction.trim().toLowerCase() !== "no"
  );
}

export function formatConstructionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("_", " ").replace(/\s+/g, " ");
  if (NON_DESCRIPTIVE_CONSTRUCTION_VALUES.has(normalized.toLowerCase())) return null;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
