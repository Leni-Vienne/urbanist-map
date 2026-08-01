import type { Component } from "vue";
import {
  Bike,
  Briefcase,
  Building,
  Bus,
  CableCar,
  Factory,
  Footprints,
  House,
  Plane,
  ShoppingBag,
  Store,
  TrainTrack,
  Trees,
  WavesHorizontal,
  SquareM,
} from "@lucide/vue";
import RoadIcon from "@/components/icons/RoadIcon.vue";
import TramIcon from "@/components/icons/TramIcon.vue";

// Colors are expressed as inline style values so they work without Tailwind purging.
export interface ProjectTag {
  slug: string;
  /** hex or CSS color string used for the chip background */
  color: string;
  /** hex or CSS color for the chip text */
  textColor: string;
  /** icon component rendered wherever the tag stands in for a missing image */
  icon: Component;
  /** if true, hidden from pickers but still rendered on existing projects */
  hidden?: boolean;
}

// inspired by OpenRailwayMap's style
export const PROJECT_TAGS: ProjectTag[] = [
  { slug: "building", color: "#92400e", textColor: "#ffffff", icon: Building },
  { slug: "residential", color: "#4caf50", textColor: "#ffffff", icon: House },
  { slug: "commercial", color: "#1565c0", textColor: "#ffffff", icon: Store },
  { slug: "retail", color: "#1565c0", textColor: "#ffffff", icon: ShoppingBag },
  { slug: "office", color: "#00c2d4", textColor: "#ffffff", icon: Briefcase },
  { slug: "industrial", color: "#f9a825", textColor: "#ffffff", icon: Factory },
  { slug: "tram", color: "#ff75d1", textColor: "#ffffff", icon: TramIcon },
  { slug: "rail", color: "#f97316", textColor: "#ffffff", icon: TrainTrack },
  { slug: "bike", color: "#60a5fa", textColor: "#ffffff", icon: Bike },
  { slug: "light_rail", color: "#22c55e", textColor: "#ffffff", icon: TramIcon },
  { slug: "park", color: "#22c55e", textColor: "#ffffff", icon: Trees },
  { slug: "road", color: "#dc2626", textColor: "#ffffff", icon: RoadIcon },
  { slug: "subway", color: "#4c4cfc", textColor: "#ffffff", icon: SquareM },
  { slug: "pedestrian", color: "#d8a82e", textColor: "#ffffff", icon: Footprints },
  { slug: "bus", color: "#ce4444", textColor: "#ffffff", icon: Bus },
  { slug: "cable_car", color: "#8b5cf6", textColor: "#ffffff", icon: CableCar },
  { slug: "airport", color: "#64748b", textColor: "#ffffff", icon: Plane },
  { slug: "waterway", color: "#299eff", textColor: "#ffffff", icon: WavesHorizontal },
];

export const PROJECT_TAG_MAP = new Map(PROJECT_TAGS.map((t) => [t.slug, t]));

/** Color of a shape whose project carries no tag, or a tag with no color of its own. */
export const DEFAULT_TAG_COLOR = "#7ea2b7";

/** Resolve a project's first tag to its hex color, matching the MVT tile expression. */
export function getProjectTagColor(tags: string[]): string {
  const firstTag = tags[0];
  if (!firstTag) return DEFAULT_TAG_COLOR;
  return PROJECT_TAG_MAP.get(firstTag)?.color ?? DEFAULT_TAG_COLOR;
}

/** Resolve a project's first tag to its icon; null when untagged or the tag is unknown. */
export function getProjectTagIcon(tags: string[]): Component | null {
  const firstTag = tags[0];
  if (!firstTag) return null;
  return PROJECT_TAG_MAP.get(firstTag)?.icon ?? null;
}

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

export { extractTagsFromOsmProperties } from "@shared/osmRules";
