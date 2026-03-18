/**
 * Import Germany proposed/construction linear transport GeoJSON into the projects table.
 * All projects are assigned to the same city (Berlin) for testing purposes.
 *
 * Covers railways, roads, aerialways, waterways, cycling and pedestrian paths.
 *
 * Usage: bun run back/src/scripts/import-germany-linear.ts
 */

import { db } from "../database";
import { cities, projects } from "../db/schema";
import { ilike, sql } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";

const GEOJSON_PATHS = [
  path.join(process.cwd(), "../osm/germany-latest_proposed_linear.geojson"),
  path.join(process.cwd(), "../osm/germany-latest_proposed_areal.geojson"),
];

const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// OSM → tag mapping (mirrors front/src/config/projectTags.ts)
// ---------------------------------------------------------------------------
interface OsmRule {
  key: string;
  values?: string[];
  tag: string;
}

const OSM_RULES: OsmRule[] = [
  // --- Tram ---
  { key: "railway", values: ["tram"], tag: "tram" },
  { key: "route", values: ["tram"], tag: "tram" },
  { key: "construction", values: ["tram"], tag: "tram" },
  { key: "proposed", values: ["tram"], tag: "tram" },
  { key: "transport_type", values: ["tram"], tag: "tram" },

  // --- Light rail ---
  { key: "railway", values: ["light_rail"], tag: "light_rail" },
  { key: "route", values: ["light_rail"], tag: "light_rail" },
  { key: "construction", values: ["light_rail"], tag: "light_rail" },
  { key: "proposed", values: ["light_rail"], tag: "light_rail" },
  { key: "transport_type", values: ["light_rail"], tag: "light_rail" },

  // --- Subway / Metro ---
  { key: "railway", values: ["subway"], tag: "subway" },
  { key: "route", values: ["subway"], tag: "subway" },
  { key: "construction", values: ["subway"], tag: "subway" },
  { key: "proposed", values: ["subway"], tag: "subway" },
  { key: "transport_type", values: ["subway"], tag: "subway" },

  // --- Rail (heavy rail, narrow gauge, monorail) ---
  { key: "railway", values: ["rail", "narrow_gauge", "monorail"], tag: "rail" },
  { key: "route", values: ["train", "railway"], tag: "rail" },
  { key: "construction", values: ["rail", "narrow_gauge", "monorail"], tag: "rail" },
  { key: "proposed", values: ["rail", "narrow_gauge", "monorail"], tag: "rail" },
  {
    key: "transport_type",
    values: ["rail", "narrow_gauge", "monorail", "miniature"],
    tag: "rail",
  },

  // --- Cable car / aerial / funicular ---
  {
    key: "aerialway",
    values: ["cable_car", "gondola", "funicular", "chair_lift", "mixed_lift", "drag_lift"],
    tag: "cable_car",
  },
  { key: "route", values: ["funicular"], tag: "cable_car" },
  {
    key: "construction",
    values: ["cable_car", "gondola", "funicular", "chair_lift"],
    tag: "cable_car",
  },
  {
    key: "proposed",
    values: ["cable_car", "gondola", "funicular", "chair_lift"],
    tag: "cable_car",
  },
  { key: "transport_type", values: ["cable_car", "gondola", "funicular"], tag: "cable_car" },

  // --- Bus / BRT ---
  { key: "construction", values: ["bus", "trolleybus", "bus_guideway"], tag: "bus" },
  { key: "proposed", values: ["bus", "trolleybus", "bus_guideway"], tag: "bus" },
  { key: "route", values: ["bus", "trolleybus"], tag: "bus" },
  { key: "amenity", values: ["bus_station"], tag: "bus" },
  { key: "highway", values: ["bus_guideway"], tag: "bus" },
  { key: "transport_type", values: ["bus"], tag: "bus" },

  // --- Cycling / bike ---
  { key: "construction", values: ["bicycle", "cycleway"], tag: "bike" },
  { key: "proposed", values: ["bicycle", "cycleway"], tag: "bike" },
  { key: "route", values: ["bicycle", "mtb"], tag: "bike" },
  { key: "highway", values: ["cycleway"], tag: "bike" },
  { key: "bicycle", values: ["yes", "designated"], tag: "bike" },
  { key: "transport_type", values: ["bike"], tag: "bike" },

  // --- Pedestrian ---
  { key: "construction", values: ["pedestrian", "footway", "path"], tag: "pedestrian" },
  { key: "proposed", values: ["pedestrian", "footway", "path"], tag: "pedestrian" },
  { key: "highway", values: ["pedestrian", "footway", "path"], tag: "pedestrian" },
  { key: "transport_type", values: ["pedestrian"], tag: "pedestrian" },

  // --- Road ---
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
  { key: "transport_type", values: ["road"], tag: "road" },

  // --- Waterway ---
  { key: "waterway", tag: "waterway" },
  { key: "natural", values: ["water", "bay", "strait"], tag: "waterway" },
  { key: "man_made", values: ["pier", "dam"], tag: "waterway" },
  { key: "transport_type", values: ["waterway"], tag: "waterway" },

  // --- Park / green ---
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

  // --- Building / urban development ---
  { key: "building", tag: "building" },
  {
    key: "landuse",
    values: ["construction", "commercial", "residential", "retail", "industrial"],
    tag: "building",
  },
];

function extractTags(props: Record<string, unknown>): string[] {
  const found = new Set<string>();
  for (const rule of OSM_RULES) {
    const val = props[rule.key];
    if (val === undefined || val === null || val === "") continue;
    const strVal = String(val);
    if (!rule.values || rule.values.includes(strVal)) {
      found.add(rule.tag);
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Date parsing — OSM dates can be "YYYY", "YYYY-MM", or "YYYY-MM-DD"
// ---------------------------------------------------------------------------
function parseOsmDate(value: unknown): { date: Date; precision: "year" | "month" | "day" } | null {
  if (!value || typeof value !== "string") return null;
  const s = value.trim();
  if (/^\d{4}$/.test(s)) {
    return { date: new Date(`${s}-01-01T00:00:00Z`), precision: "year" };
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    return { date: new Date(`${s}-01T00:00:00Z`), precision: "month" };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { date: new Date(`${s}T00:00:00Z`), precision: "day" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Geometry centroid — average of all coordinates in any GeoJSON geometry
// ---------------------------------------------------------------------------
function flatCoords(geom: GeoJSON.Geometry): number[][] {
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

function centroid(geom: GeoJSON.Geometry): { lat: number; lng: number } | null {
  const coords = flatCoords(geom);
  if (coords.length === 0) return null;
  const sumLng = coords.reduce((s, c) => s + (c[0] ?? 0), 0);
  const sumLat = coords.reduce((s, c) => s + (c[1] ?? 0), 0);
  return { lat: sumLat / coords.length, lng: sumLng / coords.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Find a German city to use for all projects — prefer Berlin
  const cityRows = await db.select().from(cities).where(ilike(cities.name, "Berlin")).limit(10);

  const germanCities = cityRows.filter((c) => c.countryCode === "DEU");
  const city = germanCities[0];
  if (!city) {
    throw new Error(
      "Could not find Berlin (DEU) in the cities table. Make sure geonames data is imported.",
    );
  }
  console.log(`Using city: ${city.name} (id=${city.id}, country=${city.countryCode})`);

  let globalInserted = 0;
  let globalSkipped = 0;

  for (const geojsonPath of GEOJSON_PATHS) {
    if (!fs.existsSync(geojsonPath)) {
      console.warn(`File not found, skipping: ${geojsonPath}`);
      continue;
    }

    console.log(`\n======================================================`);
    console.log(`Processing ${path.basename(geojsonPath)}...`);
    console.log(`======================================================`);

    const geojson = JSON.parse(fs.readFileSync(geojsonPath, "utf8")) as GeoJSON.FeatureCollection;
    console.log(`Found ${geojson.features.length} features to import`);

    // --- Pre-import diagnostics ---
    const allStatuses = new Map<string, number>();
    const allTransportTypes = new Map<string, number>();
    let noName = 0,
      noEndDate = 0,
      noStartDate = 0,
      noTags = 0;
    for (const f of geojson.features) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const status = String(p["project_status"] ?? "missing");
      allStatuses.set(status, (allStatuses.get(status) ?? 0) + 1);
      const tt = String(p["transport_type"] ?? "missing");
      allTransportTypes.set(tt, (allTransportTypes.get(tt) ?? 0) + 1);
      if (!(p["display_name"] as string | undefined)?.trim()) noName++;
      if (!parseOsmDate(p["opening_date"]) && !parseOsmDate(p["end_date"])) noEndDate++;
      if (!parseOsmDate(p["start_date"]) && !parseOsmDate(p["construction_start_expected"]))
        noStartDate++;
      if (extractTags(p).length === 0) noTags++;
    }
    console.log("\nproject_status breakdown:  ", Object.fromEntries(allStatuses));
    console.log("transport_type breakdown:  ", Object.fromEntries(allTransportTypes));
    console.log(
      `No display_name: ${noName}, no end_date: ${noEndDate}, no start_date: ${noStartDate}, no tags: ${noTags}\n`,
    );

    let inserted = 0;
    let skipped = 0;

    // Use a transaction for the entire file import for better performance
    await db.transaction(async (tx) => {
      for (let i = 0; i < geojson.features.length; i += BATCH_SIZE) {
        const batch = geojson.features.slice(i, i + BATCH_SIZE);

        const rows = batch
          .map((feature) => {
            const props = (feature.properties ?? {}) as Record<string, unknown>;

            const name = (props["display_name"] as string | undefined)?.trim();
            if (!name) {
              skipped++;
              return null;
            }

            const tags = extractTags(props);

            // Source URL: prefer source:url, then website
            const sourceUrl =
              (props["source:url"] as string | undefined) ||
              (props["website"] as string | undefined) ||
              null;

            // Dates: opening_date → endDate, start_date / construction_start_expected → startDate
            const endParsed =
              parseOsmDate(props["opening_date"]) ?? parseOsmDate(props["end_date"]);
            const startParsed =
              parseOsmDate(props["start_date"]) ??
              parseOsmDate(props["construction_start_expected"]);

            const startDate = startParsed?.date ?? null;
            const startDatePrecision = startParsed?.precision ?? null;

            const endDate = endParsed?.date ?? null;
            const endDatePrecision = endParsed?.precision ?? null;

            // Centroid for lat/lng and center_coordinate
            const geom = feature.geometry as GeoJSON.Geometry | null;
            const center = geom ? centroid(geom) : null;
            const geometry: GeoJSON.GeometryCollection | null = geom
              ? { type: "GeometryCollection", geometries: [geom] }
              : null;

            return {
              name,
              cityId: city.id,
              status: "approved" as const,
              tags: tags.length > 0 ? tags : null,
              sourceUrl,
              startDate,
              startDatePrecision,
              endDate,
              endDatePrecision,
              lat: center?.lat ?? null,
              lng: center?.lng ?? null,
              geometry: geometry
                ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)`
                : null,
              centerCoordinate: center
                ? sql`ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)`
                : null,
            };
          })
          .filter((r) => r !== null);

        if (rows.length > 0) {
          try {
            await tx.insert(projects).values(rows);
            inserted += rows.length;
          } catch (batchErr) {
            for (const row of rows) {
              try {
                await tx.insert(projects).values([row]);
                inserted++;
              } catch (rowErr) {
                skipped++;
              }
            }
          }
        }

        console.log(
          `Progress: ${Math.min(i + BATCH_SIZE, geojson.features.length)} / ${geojson.features.length}`,
        );
      }
    });

    globalInserted += inserted;
    globalSkipped += skipped;
    console.log(
      `Finished ${path.basename(geojsonPath)}. Inserted: ${inserted}, skipped: ${skipped}`,
    );
  }

  console.log(`\nDONE. Total Inserted: ${globalInserted}, Total Skipped: ${globalSkipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
