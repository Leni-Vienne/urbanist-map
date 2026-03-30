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
  /** if true, hidden from pickers but still rendered on existing projects */
  hidden?: boolean;
}

// inspired by OpenRailwayMap's style
export const PROJECT_TAGS: ProjectTag[] = [
  { slug: "tram", color: "#ff75d1", textColor: "#ffffff" },
  { slug: "light_rail", color: "#22c55e", textColor: "#ffffff" },
  { slug: "rail", color: "#f97316", textColor: "#ffffff" },
  { slug: "subway", color: "#4c4cfc", textColor: "#ffffff" },
  { slug: "bus", color: "#ce4444", textColor: "#ffffff", hidden: true },
  { slug: "bike", color: "#60a5fa", textColor: "#ffffff" },
  { slug: "road", color: "#dc2626", textColor: "#ffffff" },
  { slug: "waterway", color: "#299eff", textColor: "#ffffff" },
  { slug: "park", color: "#22c55e", textColor: "#ffffff" },
  { slug: "building", color: "#92400e", textColor: "#ffffff" }, // amber-800 / brown
  { slug: "pedestrian", color: "#3dd5d7", textColor: "#ffffff" }, // blue-400
];

export const PROJECT_TAG_MAP = new Map(PROJECT_TAGS.map((t) => [t.slug, t]));

// Re-export the shared extraction function for backward compatibility
export { extractTagsFromOsmProperties };
