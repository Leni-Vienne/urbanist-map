import { localizedBoundaryName, type BoundaryLevels } from "@shared/types/boundary";

export type { BoundaryLevels } from "@shared/types/boundary";

// The place names of a location ordered deepest-first, skipping missing levels and collapsing
// duplicate names (city-states like Berlin repeat the same name across levels).
export function boundaryLocationParts(levels: BoundaryLevels, locale: string): string[] {
  const parts: string[] = [];
  for (const level of [levels.city, levels.state, levels.country]) {
    const name = localizedBoundaryName(level, locale);
    if (name && !parts.includes(name)) {
      parts.push(name);
    }
  }
  return parts;
}

// Builds "City, State, Country" from the boundary-derived levels.
export function formatBoundaryLocation(levels: BoundaryLevels, locale: string): string {
  return boundaryLocationParts(levels, locale).join(", ");
}
