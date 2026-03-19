import { extractTagsFromOsmProperties } from "@shared/osmRules";

/**
 * Predefined project tags with display labels and colors.
 * Colors are expressed as inline style values so they work without Tailwind purging.
 */
interface ProjectTag {
  slug: string;
  /** hex or CSS color string used for the chip background */
  color: string;
  /** hex or CSS color for the chip text */
  textColor: string;
}

export const PROJECT_TAGS: ProjectTag[] = [
  { slug: "tram", color: "#d877b8", textColor: "#ffffff" }, // pink-400
  { slug: "light_rail", color: "#22c55e", textColor: "#000000" }, // same color as park but OSM has none anyway
  { slug: "rail", color: "#f97316", textColor: "#ffffff" }, // orange-500
  { slug: "subway", color: "#0202fe", textColor: "#ffffff" }, // purple-500
  { slug: "bus", color: "#ce4444", textColor: "#ffffff" }, // muted dark red
  { slug: "bike", color: "#16a34a", textColor: "#ffffff" }, // green-600
  { slug: "road", color: "#64748b", textColor: "#ffffff" }, // slate-500
  { slug: "waterway", color: "#3b82f6", textColor: "#ffffff" }, // blue-500
  { slug: "park", color: "#22c55e", textColor: "#ffffff" }, // green-500
  { slug: "building", color: "#78716c", textColor: "#ffffff" }, // stone-500
];

export const PROJECT_TAG_MAP = new Map(PROJECT_TAGS.map((t) => [t.slug, t]));

// Re-export the shared extraction function for backward compatibility
export { extractTagsFromOsmProperties };
