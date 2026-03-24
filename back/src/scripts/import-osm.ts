/**
 * Import Germany proposed/construction linear transport GeoJSON into the projects table.
 * Projects are auto-approved and linked to the "osm_germany" import source.
 * Existing projects are updated via upsert on (importSourceId, externalId).
 * Projects not seen in the current sync are automatically pruned.
 *
 * Covers railways, roads, aerialways, waterways, cycling and pedestrian paths.
 *
 * Usage: bun run back/src/scripts/import-osm.ts
 */

import { db } from "../database";
import { projects, importSources, type TimelineStatus } from "../db/schema";
import { sql, eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { EXTENDED_OSM_RULES } from "@shared/osmRules";

const GEOJSON_PATHS = [
  path.join(process.cwd(), "../osm/germany-latest_proposed_linear.geojson"),
  path.join(process.cwd(), "../osm/germany-latest_proposed_areal.geojson"),
];

const BATCH_SIZE = 50;

// Import source configuration
const IMPORT_SOURCE_SLUG = "osm_germany";
const IMPORT_SOURCE_CONFIG = {
  slug: IMPORT_SOURCE_SLUG,
  name: "OpenStreetMap Germany",
  type: "osm",
  urlTemplate: "https://www.openstreetmap.org/{id}",
  attribution: "© OpenStreetMap contributors",
  enabled: true,
};

// ---------------------------------------------------------------------------
// OSM project_status → timeline status mapping
// ---------------------------------------------------------------------------
function mapTimelineStatus(projectStatus: string | undefined): TimelineStatus {
  // OSM project_status values: "proposed" or "under_construction"
  // Map to our timeline statuses
  switch (projectStatus) {
    case "under_construction":
      return "under_construction";
    case "proposed":
    default:
      return "proposed";
  }
}

// ---------------------------------------------------------------------------
// OSM → tag mapping (uses shared rules from @shared/osmRules)
// ---------------------------------------------------------------------------
function extractTags(props: Record<string, unknown>): string[] {
  const found = new Set<string>();

  // First, check for transport_type directly which is the most accurate
  const ttRaw = props["transport_type"];
  if (typeof ttRaw === "string" || typeof ttRaw === "number") {
    const tt = String(ttRaw);
    if (
      tt === "rail" ||
      tt === "light_rail" ||
      tt === "subway" ||
      tt === "tram" ||
      tt === "cable_car" ||
      tt === "bus" ||
      tt === "bike" ||
      tt === "pedestrian" ||
      tt === "road" ||
      tt === "waterway" ||
      tt === "park"
    ) {
      found.add(tt);
    } else if (tt === "narrow_gauge" || tt === "monorail" || tt === "miniature") {
      found.add("rail");
    } else if (tt === "gondola" || tt === "funicular") {
      found.add("cable_car");
    }
  }

  // Then apply shared OSM rules to capture secondary tags (like parks or buildings)
  // or catch anything that didn't have a clean transport_type
  for (const rule of EXTENDED_OSM_RULES) {
    const val = props[rule.key];
    if (typeof val === "string" || typeof val === "number") {
      const strVal = String(val);
      if (!rule.values || rule.values.includes(strVal)) {
        found.add(rule.tag);
      }
    }
  }

  // Clean up contradictory tags
  // Many bike paths are mapped on OSM as highway=path, which triggers the pedestrian rule above
  if (found.has("bike") && props["transport_type"] === "bike") {
    found.delete("pedestrian");
  }

  return [...found];
}

// ---------------------------------------------------------------------------
// Date parsing — OSM dates can be "YYYY", "YYYY-MM", or "YYYY-MM-DD"
// ---------------------------------------------------------------------------
function parseOsmDate(value: unknown): { date: Date; precision: "year" | "month" | "day" } | null {
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

  // Validate the date is actually valid (e.g., not 2024-13-45)
  if (isNaN(date.getTime())) {
    return null;
  }

  return { date, precision };
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
// Batched KNN country code lookup
// ---------------------------------------------------------------------------
const KNN_CHUNK_SIZE = 1_000;

async function resolveCountryCodes(
  points: Array<{ lat: number; lng: number } | null>,
): Promise<Array<string | null>> {
  const results: Array<string | null> = Array.from({ length: points.length }, () => null);

  // Collect indices of points that actually have coordinates
  const validIndices: number[] = [];
  const lats: number[] = [];
  const lngs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (pt != null) {
      validIndices.push(i);
      lats.push(pt.lat);
      lngs.push(pt.lng);
    }
  }

  // Process in chunks to avoid excessive memory in a single query
  for (let offset = 0; offset < validIndices.length; offset += KNN_CHUNK_SIZE) {
    const chunkLats = lats.slice(offset, offset + KNN_CHUNK_SIZE);
    const chunkLngs = lngs.slice(offset, offset + KNN_CHUNK_SIZE);

    const latLiteral = `ARRAY[${chunkLats.join(",")}]::float8[]`;
    const lngLiteral = `ARRAY[${chunkLngs.join(",")}]::float8[]`;
    const rows = (await db.execute(
      sql.raw(`
      SELECT c.country_code
      FROM unnest(${latLiteral}, ${lngLiteral}) AS input(lat, lng)
      JOIN LATERAL (
        SELECT country_code
        FROM cities
        ORDER BY coordinates <-> ST_SetSRID(ST_MakePoint(input.lng, input.lat), 4326)
        LIMIT 1
      ) c ON true
    `),
    )) as Array<{ country_code: string | null }>;

    for (let i = 0; i < rows.length; i++) {
      const originalIndex = validIndices[offset + i];
      if (originalIndex !== undefined) {
        results[originalIndex] = rows[i]?.country_code ?? null;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Get or create import source
  console.log(`Setting up import source: ${IMPORT_SOURCE_SLUG}`);
  let importSource = await db
    .select()
    .from(importSources)
    .where(eq(importSources.slug, IMPORT_SOURCE_SLUG))
    .limit(1)
    .then((rows) => rows[0]);

  if (!importSource) {
    console.log(`Import source not found, creating: ${IMPORT_SOURCE_SLUG}`);
    const created = await db.insert(importSources).values(IMPORT_SOURCE_CONFIG).returning();
    importSource = created[0];
  }

  if (!importSource) {
    throw new Error(`Failed to create or retrieve import source: ${IMPORT_SOURCE_SLUG}`);
  }

  console.log(`Using import source: ${importSource.name} (id=${importSource.id})`);

  // Record sync start time for pruning stale data later
  const syncStartTime = new Date();
  await db
    .update(importSources)
    .set({ lastSyncStartedAt: syncStartTime })
    .where(eq(importSources.id, importSource.id));

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

    // Resolve countryCode for all features via batched KNN lookup before the upsert loop
    console.log(`Resolving country codes for ${geojson.features.length} features...`);
    const featureCentroids = geojson.features.map((f) => {
      const geom = f.geometry as GeoJSON.Geometry | null;
      return geom ? centroid(geom) : null;
    });
    const countryCodes = await resolveCountryCodes(featureCentroids);
    console.log(`Country code resolution complete.`);

    // Process features individually to handle conflicts and errors gracefully
    for (let i = 0; i < geojson.features.length; i += BATCH_SIZE) {
      const batch = geojson.features.slice(i, i + BATCH_SIZE);

      for (let batchOffset = 0; batchOffset < batch.length; batchOffset++) {
        const feature = batch[batchOffset]!;
        const featureIndex = i + batchOffset;
        try {
          const props = (feature.properties ?? {}) as Record<string, unknown>;

          const name = (props["display_name"] as string | undefined)?.trim() || null;
          const countryCode = countryCodes[featureIndex] ?? null;
          if (!countryCode) {
            skipped++;
            continue;
          }

          const tags = extractTags(props);

          // Map OSM project_status to our timeline status
          const timelineStatus = mapTimelineStatus(props["project_status"] as string | undefined);

          // Extract externalId from feature.id (e.g., "relation/123456" or "way/789")
          const externalId = feature.id ? String(feature.id) : null;

          // Store all OSM properties as JSON for future use
          const externalProperties = props;

          // Extract OSM last modified timestamp
          let osmLastModified: Date | null = null;
          if (props["osm_last_modified"]) {
            const parsed = new Date(String(props["osm_last_modified"]));
            if (!isNaN(parsed.getTime())) {
              osmLastModified = parsed;
            }
          }

          // Source URL: prefer source:url, then website
          const sourceUrl =
            (props["source:url"] as string | undefined) ||
            (props["website"] as string | undefined) ||
            null;

          // Dates: opening_date → endDate, start_date / construction_start_expected → startDate
          const endParsed = parseOsmDate(props["opening_date"]) ?? parseOsmDate(props["end_date"]);
          const startParsed =
            parseOsmDate(props["start_date"]) ?? parseOsmDate(props["construction_start_expected"]);

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

          const geometryJson = geometry ? JSON.stringify(geometry) : null;

          const row = {
            name,
            cityId: null,
            countryCode,
            status: "approved" as const,
            timelineStatus,
            importSourceId: importSource.id,
            externalId,
            externalProperties,
            externalLastModified: osmLastModified,
            lastImportedAt: syncStartTime,
            tags: tags.length > 0 ? tags : null,
            sourceUrl,
            startDate,
            startDatePrecision,
            endDate,
            endDatePrecision,
            lat: center?.lat ?? null,
            lng: center?.lng ?? null,
            geometry: geometryJson
              ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${geometryJson}), 4326)`
              : null,
            centerCoordinate: center
              ? sql`ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)`
              : null,
            // Spatial size in meters, used to:
            //   - decide zoom level when flying to a project
            //   - progressively hide center-point markers when the shape is large enough
            //   - drive the size filter slider in the UI
            //
            // The cap is GREATEST(bbox_width, bbox_height) -- the longest side of the bounding box.
            // Using the bbox diagonal instead would inflate areas by up to sqrt(2) (~41%) for square shapes.
            //
            // GREATEST(ST_Length, ST_Perimeter) handles both geometry families:
            //   - LineString/MultiLineString: ST_Length > 0, ST_Perimeter = 0
            //   - Polygon/MultiPolygon:       ST_Length = 0, ST_Perimeter > 0
            //
            // Examples (lines):
            //   - A20 motorway (170km route, ~200km bbox diagonal): LEAST(170km, 200km) = 170km  correct
            //   - B96a (675m total, 7200m bbox diagonal):           LEAST(675m,  7200m) = 675m   correct
            // Examples (polygons):
            //   - 100x100m parking lot (400m perimeter):            LEAST(400m, 100m)   = 100m   correct
            //   - Circular park r=500m (3141m perimeter):           LEAST(3141m, 1000m) = 1000m  correct (diameter)
            //
            // ST_Area > 0 discriminates polygons from lines (ST_Dimension is unreliable on GeometryCollection).
            // The geometry JSON is parsed once via a scalar subquery to avoid redundant work.
            geometrySizeM: geometryJson
              ? sql`(
                  SELECT CASE
                    WHEN ST_Area(g) > 0 THEN
                      LEAST(
                        ST_Perimeter(g::geography),
                        GREATEST(
                          ST_Distance(
                            ST_MakePoint(ST_XMin(e), ST_YMin(e))::geography,
                            ST_MakePoint(ST_XMax(e), ST_YMin(e))::geography
                          ),
                          ST_Distance(
                            ST_MakePoint(ST_XMin(e), ST_YMin(e))::geography,
                            ST_MakePoint(ST_XMin(e), ST_YMax(e))::geography
                          )
                        )
                      )
                    ELSE
                      LEAST(
                        ST_Length(g::geography),
                        ST_Length(ST_BoundingDiagonal(e)::geography)
                      )
                  END
                  FROM (VALUES (ST_GeomFromGeoJSON(${geometryJson}))) t(g),
                  LATERAL (SELECT ST_Envelope(t.g)) l(e)
                )`
              : null,
          };

          await db
            .insert(projects)
            .values(row)
            .onConflictDoUpdate({
              target: [projects.importSourceId, projects.externalId],
              set: {
                name: row.name,
                cityId: row.cityId,
                countryCode: row.countryCode,
                timelineStatus: row.timelineStatus,
                externalProperties: row.externalProperties,
                externalLastModified: row.externalLastModified,
                lastImportedAt: row.lastImportedAt,
                tags: row.tags,
                sourceUrl: row.sourceUrl,
                startDate: row.startDate,
                startDatePrecision: row.startDatePrecision,
                endDate: row.endDate,
                endDatePrecision: row.endDatePrecision,
                lat: row.lat,
                lng: row.lng,
                geometry: row.geometry,
                centerCoordinate: row.centerCoordinate,
                geometrySizeM: row.geometrySizeM,
              },
            });
          inserted++;
        } catch (rowErr) {
          console.error(`Failed to insert/update row:`, rowErr);
          skipped++;
        }
      }

      console.log(
        `Progress: ${Math.min(i + BATCH_SIZE, geojson.features.length)} / ${geojson.features.length}`,
      );
    }

    globalInserted += inserted;
    globalSkipped += skipped;
    console.log(
      `Finished ${path.basename(geojsonPath)}. Inserted: ${inserted}, skipped: ${skipped}`,
    );
  }

  console.log(`\nDONE. Total Inserted: ${globalInserted}, Total Skipped: ${globalSkipped}`);

  // Prune stale projects that were not updated during this sync
  // Projects with overlays are soft-detached (import link severed, geometry cleared, overlays kept).
  // Projects without overlays are hard-deleted.
  console.log(`\nPruning stale projects not seen since ${syncStartTime.toISOString()}...`);
  const staleCondition = sql`import_source_id = ${importSource.id} AND (last_imported_at IS NULL OR last_imported_at < ${syncStartTime})`;
  const hasOverlays = sql`EXISTS (SELECT 1 FROM overlays WHERE project_id = projects.id)`;

  try {
    const hardDeleted = await db
      .delete(projects)
      .where(sql`${staleCondition} AND NOT (${hasOverlays})`)
      .returning({ id: projects.id });
    console.log(`Hard-deleted ${hardDeleted.length} stale projects with no overlays`);
  } catch (err) {
    console.error("Failed to hard-delete stale projects:", err);
  }

  try {
    const softDetached = await db
      .update(projects)
      .set({
        detachedAt: new Date(),
        importSourceId: null,
        externalId: null,
        externalProperties: null,
        externalLastModified: null,
        geometry: null,
        geometrySizeM: null,
      })
      .where(sql`${staleCondition} AND detached_at IS NULL AND (${hasOverlays})`)
      .returning({ id: projects.id });
    console.log(`Soft-detached ${softDetached.length} stale projects with overlays`);
  } catch (err) {
    console.error("Failed to soft-detach stale projects:", err);
  }

  // Update lastSyncAt to mark successful completion
  await db
    .update(importSources)
    .set({ lastSyncAt: new Date() })
    .where(eq(importSources.id, importSource.id));

  console.log(`Import complete. Updated lastSyncAt for ${IMPORT_SOURCE_SLUG}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
