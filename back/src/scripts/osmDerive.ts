/**
 * Field derivation from OSM GeoJSON feature properties, shared by the importer and the
 * GeoJSON stats script so both read the extraction the same way.
 */

import { EXTENDED_OSM_RULES, PRESENT_STATE_OSM_KEYS, isRedevelopmentSite } from "@shared/osmRules";
import type { TimelineStatus } from "../db/schema";

export function mapTimelineStatus(projectStatus: string | undefined): TimelineStatus {
  switch (projectStatus) {
    case "under_construction":
      return "under_construction";
    case "planned":
      return "planned";
    case "proposed":
    default:
      return "proposed";
  }
}

export function extractTags(props: Record<string, unknown>): string[] {
  const found = new Set<string>();

  // On redevelopment sites, plain keys describe the feature being replaced
  // (e.g. aeroway=aerodrome with planned:landuse=residential), so skip them.
  const redevelopment = isRedevelopmentSite(props);
  for (const rule of EXTENDED_OSM_RULES) {
    if (redevelopment && PRESENT_STATE_OSM_KEYS.has(rule.key)) continue;
    const val = props[rule.key];
    if (typeof val === "string" || typeof val === "number") {
      const strVal = String(val);
      if (!rule.values || rule.values.includes(strVal)) {
        found.add(rule.tag);
      }
    }
  }

  // Many bike paths are mapped on OSM as highway=path, which triggers the pedestrian rule.
  // Ensure "bike" always precedes "pedestrian" in the output array when both are present.
  const tags = [...found];
  const bikeIdx = tags.indexOf("bike");
  const pedIdx = tags.indexOf("pedestrian");
  if (bikeIdx !== -1 && pedIdx !== -1 && bikeIdx > pedIdx) {
    tags.splice(bikeIdx, 1);
    tags.splice(pedIdx, 0, "bike");
  }
  return tags;
}

// OSM dates can be "YYYY", "YYYY-MM", or "YYYY-MM-DD".
export function parseOsmDate(
  value: unknown,
): { date: Date; precision: "year" | "month" | "day" } | null {
  if (!value || typeof value !== "string") return null;
  const s = value.trim();
  let date: Date;
  let precision: "year" | "month" | "day";

  if (/^\d{4}$/.test(s)) {
    date = new Date(`${s}-01-01T00:00:00Z`);
    precision = "year";
  } else if (/^\d{4}-\d{2}$/.test(s)) {
    date = new Date(`${s}-01T00:00:00Z`);
    precision = "month";
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    date = new Date(`${s}T00:00:00Z`);
    precision = "day";
  } else {
    return null;
  }

  if (isNaN(date.getTime())) return null;
  return { date, precision };
}

// Prefer source:url, then the first URL in the source tag, then website as a fallback.
export function deriveSourceUrl(props: Record<string, unknown>): string | null {
  const firstUrlInSource =
    (props["source"] as string | undefined)
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("http")) ?? null;
  return (
    (props["source:url"] as string | undefined) ||
    firstUrlInSource ||
    (props["website"] as string | undefined) ||
    null
  );
}

export function flatCoords(geom: GeoJSON.Geometry): number[][] {
  switch (geom.type) {
    case "Point":
      return [geom.coordinates as number[]];
    case "LineString":
    case "MultiPoint":
      return geom.coordinates as number[][];
    case "Polygon":
    case "MultiLineString":
      return (geom.coordinates as number[][][]).flat();
    case "MultiPolygon":
      return (geom.coordinates as number[][][][]).flat(2);
    case "GeometryCollection":
      return geom.geometries.flatMap(flatCoords);
    default:
      return [];
  }
}

export function centroid(geom: GeoJSON.Geometry): { lat: number; lng: number } | null {
  const coords = flatCoords(geom);
  if (coords.length === 0) return null;
  const sumLng = coords.reduce((s, c) => s + (c[0] ?? 0), 0);
  const sumLat = coords.reduce((s, c) => s + (c[1] ?? 0), 0);
  return { lat: sumLat / coords.length, lng: sumLng / coords.length };
}
