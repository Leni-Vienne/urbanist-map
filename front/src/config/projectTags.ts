/**
 * Predefined project tags with display labels and colors.
 * Colors are expressed as inline style values so they work without Tailwind purging.
 */
export interface ProjectTag {
  slug: string;
  /** hex or CSS color string used for the chip background */
  color: string;
  /** hex or CSS color for the chip text */
  textColor: string;
}

export const PROJECT_TAGS: ProjectTag[] = [
  { slug: "tram", color: "#f472b6", textColor: "#ffffff" }, // pink-400
  { slug: "rail", color: "#f97316", textColor: "#ffffff" }, // orange-500
  { slug: "subway", color: "#a855f7", textColor: "#ffffff" }, // purple-500
  { slug: "bus", color: "#eab308", textColor: "#ffffff" }, // yellow-500
  { slug: "bike", color: "#16a34a", textColor: "#ffffff" }, // green-600
  { slug: "road", color: "#64748b", textColor: "#ffffff" }, // slate-500
  { slug: "bridge", color: "#6366f1", textColor: "#ffffff" }, // indigo-500
  { slug: "waterway", color: "#3b82f6", textColor: "#ffffff" }, // blue-500
  { slug: "park", color: "#22c55e", textColor: "#ffffff" }, // green-500
  { slug: "building", color: "#78716c", textColor: "#ffffff" }, // stone-500
];

export const PROJECT_TAG_MAP = new Map(PROJECT_TAGS.map((t) => [t.slug, t]));

// ---------------------------------------------------------------------------
// OSM → tag mapping rules
// Each rule: if properties[key] matches one of the listed values (or any value
// when values is omitted), emit the tag slug.
// ---------------------------------------------------------------------------
interface OsmRule {
  key: string;
  values?: string[];
  tag: string;
}

const OSM_RULES: OsmRule[] = [
  // Tram
  { key: "railway", values: ["tram"], tag: "tram" },
  { key: "route", values: ["tram"], tag: "tram" },

  // Rail (heavy + light)
  { key: "railway", values: ["rail", "light_rail", "narrow_gauge", "monorail"], tag: "rail" },
  { key: "route", values: ["train", "light_rail", "railway"], tag: "rail" },

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

  // Bridge
  { key: "bridge", values: ["yes"], tag: "bridge" },
  { key: "man_made", values: ["bridge"], tag: "bridge" },

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

  // Building
  { key: "building", tag: "building" },
  {
    key: "landuse",
    values: ["construction", "commercial", "residential", "retail", "industrial"],
    tag: "building",
  },
];

/**
 * Extract project tag slugs from a collection of GeoJSON feature property objects.
 * Returns deduplicated slugs for any OSM rule that matches.
 */
export function extractTagsFromOsmProperties(
  featureProperties: Record<string, unknown>[],
): string[] {
  const found = new Set<string>();

  for (const props of featureProperties) {
    for (const rule of OSM_RULES) {
      const val = props[rule.key];
      if (val === undefined || val === null || val === "") continue;
      const strVal = String(val);
      if (!rule.values || rule.values.includes(strVal)) {
        found.add(rule.tag);
      }
    }
  }

  return [...found];
}
