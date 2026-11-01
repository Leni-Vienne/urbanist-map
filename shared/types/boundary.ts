// Name variants of one administrative boundary. Each response may supply a subset of locales.
export interface LocalizedBoundaryName {
  name: string; // OSM `name` (native/local language)
  nameEn: string | null; // OSM `name:en`
  names: Record<string, string> | null; // Available `name:*` variants, keyed by language code
}
