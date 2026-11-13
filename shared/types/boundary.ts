// Name variants of one administrative boundary. Each response may supply a subset of locales.
export interface LocalizedBoundaryName {
  name: string; // OSM `name` (native/local language)
  nameEn: string | null; // OSM `name:en`
  names: Record<string, string> | null; // Available `name:*` variants, keyed by language code
}

export interface BoundaryPathEntry extends LocalizedBoundaryName {
  adminLevel: number;
}

export const BOUNDARY_LEVEL_RANGES = {
  city: [6, 8],
  state: [4, 4],
  country: [2, 2],
} as const;

export type BoundaryLevel = keyof typeof BOUNDARY_LEVEL_RANGES;
export type BoundaryLevels<T = LocalizedBoundaryName> = Record<BoundaryLevel, T | null>;

export function selectBoundaryLevels<T extends { adminLevel: number }>(
  entries: readonly T[],
): BoundaryLevels<T> {
  const deepestFirst = entries.toSorted((a, b) => b.adminLevel - a.adminLevel);
  function pick([min, max]: readonly [number, number]): T | null {
    return deepestFirst.find((entry) => entry.adminLevel >= min && entry.adminLevel <= max) ?? null;
  }
  return {
    city: pick(BOUNDARY_LEVEL_RANGES.city),
    state: pick(BOUNDARY_LEVEL_RANGES.state),
    country: pick(BOUNDARY_LEVEL_RANGES.country),
  };
}

export function localizedBoundaryName(
  entry: LocalizedBoundaryName | null,
  locale: string,
): string | null {
  return entry ? (entry.names?.[locale] ?? entry.nameEn ?? entry.name) : null;
}
