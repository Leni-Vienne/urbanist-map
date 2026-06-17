import { extractTagsFromOsmProperties } from "@shared/osmRules";

// Colors are expressed as inline style values so they work without Tailwind purging.
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
  { slug: "building", color: "#92400e", textColor: "#ffffff" },
  { slug: "residential", color: "#4caf50", textColor: "#ffffff" },
  { slug: "commercial", color: "#1565c0", textColor: "#ffffff" },
  { slug: "retail", color: "#1565c0", textColor: "#ffffff" },
  { slug: "office", color: "#00c2d4", textColor: "#ffffff" },
  { slug: "industrial", color: "#f9a825", textColor: "#ffffff" },
  { slug: "tram", color: "#ff75d1", textColor: "#ffffff" },
  { slug: "rail", color: "#f97316", textColor: "#ffffff" },
  { slug: "bike", color: "#60a5fa", textColor: "#ffffff" },
  { slug: "light_rail", color: "#22c55e", textColor: "#ffffff" },
  { slug: "park", color: "#22c55e", textColor: "#ffffff" },
  { slug: "road", color: "#dc2626", textColor: "#ffffff" },
  { slug: "subway", color: "#4c4cfc", textColor: "#ffffff" },
  { slug: "pedestrian", color: "#d8a82e", textColor: "#ffffff" },
  { slug: "bus", color: "#ce4444", textColor: "#ffffff" },
  { slug: "cable_car", color: "#8b5cf6", textColor: "#ffffff" },
  { slug: "airport", color: "#64748b", textColor: "#ffffff" },
  { slug: "waterway", color: "#299eff", textColor: "#ffffff" },
];

export const PROJECT_TAG_MAP = new Map(PROJECT_TAGS.map((t) => [t.slug, t]));

// Tags that also carry the implicit `building` tag (the building-category tags plus the
// generic `building` itself). Grouped separately in the filter UI.
export const BUILDING_CATEGORY_TAGS = new Set([
  "building",
  "residential",
  "commercial",
  "retail",
  "office",
  "industrial",
]);

export { extractTagsFromOsmProperties };
