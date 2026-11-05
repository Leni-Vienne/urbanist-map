import type { LocalizedBoundaryName } from "@shared/types/boundary";

export interface BoundaryLevels {
  city: LocalizedBoundaryName | null;
  state: LocalizedBoundaryName | null;
  country: LocalizedBoundaryName | null;
  countryCode: string | null;
}

// Prefer the name in the current UI locale, falling back to English, then the boundary's local name.
function localizedBoundaryName(level: LocalizedBoundaryName | null, locale: string): string | null {
  if (!level) {
    return null;
  }
  return level.names?.[locale] ?? level.nameEn ?? level.name;
}

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
