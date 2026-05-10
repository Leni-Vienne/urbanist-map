/**
 * Import worldwide proposed/construction features GeoJSON into the projects table.
 * Projects are auto-approved and linked to the "osm_world" import source.
 * Existing projects are updated via upsert on (importSourceId, externalId).
 * Projects not seen in the current sync are automatically pruned.
 *
 * Covers railways, roads, aerialways, waterways, cycling and pedestrian paths,
 * buildings under construction, and parks/green spaces.
 *
 * Usage: bun run back/src/scripts/import-osm.ts
 */

// Use postgres.js instead of Bun's native SQL client: Bun double-encodes jsonb parameters
// (https://github.com/oven-sh/bun/issues/28819), which corrupts externalProperties on insert.
import { drizzle } from "drizzle-orm/postgres-js";
import postgresJs from "postgres";
import { projects, importSources, countries, type TimelineStatus } from "../db/schema";
import { sql, eq } from "drizzle-orm";
import { config } from "../config";

const pgClient = postgresJs(config.DATABASE_URL);
const db = drizzle({ client: pgClient });
import * as fs from "node:fs";
import * as path from "node:path";
import { EXTENDED_OSM_RULES } from "@shared/osmRules";

const GEOJSON_PATHS = [
  path.join(process.cwd(), "scripts/osm-extract/planet-latest_proposed_linear.geojson"),
  path.join(process.cwd(), "scripts/osm-extract/planet-latest_proposed_areal.geojson"),
];

const UPSERT_BATCH_SIZE = 200;

// Import source configuration
const IMPORT_SOURCE_SLUG = "osm_world";
const IMPORT_SOURCE_CONFIG = {
  slug: IMPORT_SOURCE_SLUG,
  name: "OpenStreetMap",
  type: "osm",
  urlTemplate: "https://www.openstreetmap.org/{id}",
  attribution: "© OpenStreetMap contributors",
  enabled: true,
};

function mapTimelineStatus(projectStatus: string | undefined): TimelineStatus {
  // OSM project_status values: "proposed" or "under_construction"
  // Map to our timeline statuses
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

    const pointsSql = sql.join(
      chunkLats.map((lat, i) => sql`(${lat}, ${chunkLngs[i]})`),
      sql`, `,
    );
    const rows = (await db.execute(
      sql`
      SELECT c.country_code
      FROM (VALUES ${pointsSql}) AS input(lat, lng)
      JOIN LATERAL (
        SELECT country_code
        FROM cities
        ORDER BY coordinates <-> ST_SetSRID(ST_MakePoint(input.lng::float8, input.lat::float8), 4326)
        LIMIT 1
      ) c ON true
    `,
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

const TRANSIENT_PG_CODES = new Set(["57P03", "08006", "08001", "08004"]);

function isTransient(err: unknown): boolean {
  const candidates = [err, (err as Record<string, unknown> | null)?.cause];
  return candidates.some(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      TRANSIENT_PG_CODES.has((e as Record<string, string | undefined>).code ?? ""),
  );
}

async function waitForDb(): Promise<void> {
  const start = Date.now();
  const maxWaitMs = 120_000;
  let delay = 2_000;
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      await db.execute(sql`SELECT 1`);
      console.log("Database connection restored.");
      return;
    } catch {
      console.log(`Database still unavailable, retrying in ${delay / 1000}s...`);
      delay = Math.min(delay * 2, 30_000);
    }
  }
  throw new Error("Database did not become available within the timeout period.");
}

// Flush a batch of rows to the database via a single multi-row upsert.
// Falls back to individual inserts if the batch fails (e.g. bad geometry on one row).
// Retries the whole batch if a transient connection error is detected.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function flushBatch(batch: any[]): Promise<{ ok: number; fail: number }> {
  if (batch.length === 0) return { ok: 0, fail: 0 };
  const conflictSet = {
    name: sql`EXCLUDED.name`,
    description: sql`EXCLUDED.description`,
    cityId: sql`EXCLUDED.city_id`,
    countryCode: sql`EXCLUDED.country_code`,
    timelineStatus: sql`EXCLUDED.timeline_status`,
    externalProperties: sql`EXCLUDED.external_properties`,
    externalLastModified: sql`EXCLUDED.external_last_modified`,
    lastImportedAt: sql`EXCLUDED.last_imported_at`,
    tags: sql`EXCLUDED.tags`,
    sourceUrl: sql`EXCLUDED.source_url`,
    startDate: sql`EXCLUDED.start_date`,
    startDatePrecision: sql`EXCLUDED.start_date_precision`,
    endDate: sql`EXCLUDED.end_date`,
    endDatePrecision: sql`EXCLUDED.end_date_precision`,
    lat: sql`EXCLUDED.lat`,
    lng: sql`EXCLUDED.lng`,
    geometry: sql`EXCLUDED.geometry`,
    centerCoordinate: sql`EXCLUDED.center_coordinate`,
    // Reset geometry_size_m to NULL when geometry changes so it gets recomputed below.
    // Keeps the existing value when geometry is unchanged to avoid redundant PostGIS work.
    geometrySizeM: sql`CASE WHEN projects.geometry IS DISTINCT FROM EXCLUDED.geometry THEN NULL ELSE projects.geometry_size_m END`,
    // Override Drizzle's $onUpdate auto-bump so updated_at only moves when a meaningful field
    // actually changed. Without this, every daily run would touch updated_at on every row.
    // last_imported_at is intentionally excluded (it's bumped every sync by design).
    updatedAt: sql`CASE WHEN (
      projects.name, projects.description, projects.country_code,
      projects.timeline_status, projects.external_properties,
      projects.external_last_modified, projects.tags, projects.source_url,
      projects.start_date, projects.start_date_precision,
      projects.end_date, projects.end_date_precision,
      projects.geometry
    ) IS DISTINCT FROM (
      EXCLUDED.name, EXCLUDED.description, EXCLUDED.country_code,
      EXCLUDED.timeline_status, EXCLUDED.external_properties,
      EXCLUDED.external_last_modified, EXCLUDED.tags, EXCLUDED.source_url,
      EXCLUDED.start_date, EXCLUDED.start_date_precision,
      EXCLUDED.end_date, EXCLUDED.end_date_precision,
      EXCLUDED.geometry
    ) THEN NOW() ELSE projects.updated_at END`,
  };
  try {
    await db
      .insert(projects)
      .values(batch)
      .onConflictDoUpdate({
        target: [projects.importSourceId, projects.externalId],
        set: conflictSet,
      });
    return { ok: batch.length, fail: 0 };
  } catch (batchErr) {
    if (isTransient(batchErr)) {
      console.warn("Transient DB error on batch, waiting for recovery...");
      await waitForDb();
      return flushBatch(batch);
    }
    // Batch failed, fall back to individual inserts so one bad row doesn't discard the rest
    let ok = 0;
    let fail = 0;
    for (const row of batch) {
      try {
        await db
          .insert(projects)
          .values(row)
          .onConflictDoUpdate({
            target: [projects.importSourceId, projects.externalId],
            set: conflictSet,
          });
        ok++;
      } catch (rowErr) {
        if (isTransient(rowErr)) {
          console.warn("Transient DB error on row, waiting for recovery...");
          await waitForDb();
          try {
            await db
              .insert(projects)
              .values(row)
              .onConflictDoUpdate({
                target: [projects.importSourceId, projects.externalId],
                set: conflictSet,
              });
            ok++;
          } catch (retryErr) {
            console.error(`Failed to insert/update row after retry:`, retryErr);
            fail++;
          }
        } else {
          console.error(`Failed to insert/update row:`, rowErr);
          fail++;
        }
      }
    }
    return { ok, fail };
  }
}

async function main() {
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

  // Load valid country codes once to guard against KNN returning codes not in our countries table
  // (e.g. XKX for Kosovo, which uses a user-assigned code not in ISO 3166-1)
  const validCountryCodes = new Set(
    (await db.select({ code: countries.code }).from(countries)).map((r) => r.code),
  );
  console.log(`Loaded ${validCountryCodes.size} valid country codes`);

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

    // Build rows and flush in batches.
    // geometrySizeM is intentionally omitted here, it is computed in a single bulk UPDATE after all
    // files are processed, which avoids parsing geometryJson twice per row and lets PostGIS pipeline
    // the geography computations across all rows in one pass.
    // any[] because SQL<unknown> expressions for geometry/centerCoordinate are valid at runtime
    // but not assignable to the strict $inferInsert column types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingRows: any[] = [];

    for (let i = 0; i < geojson.features.length; i++) {
      const feature = geojson.features[i]!;
      try {
        const props = (feature.properties ?? {}) as Record<string, unknown>;

        const name = (props["display_name"] as string | undefined)?.trim() || null;
        const description = (props["description"] as string | undefined)?.trim() || null;
        const countryCode = countryCodes[i] ?? null;
        if (!countryCode || !validCountryCodes.has(countryCode)) {
          skipped++;
          continue;
        }

        const tags = extractTags(props);

        // Map OSM project_status to our timeline status
        const timelineStatus = mapTimelineStatus(props["project_status"] as string | undefined);

        // Extract externalId from feature.id (e.g., "relation/123456" or "way/789")
        const externalId = feature.id ? String(feature.id) : null;

        // Store all OSM properties as JSON, stripping any image URL that isn't http/https
        const rawImage = (props["image"] as string | undefined)?.trim() ?? "";
        const externalProperties =
          rawImage && /^https?:\/\//.test(rawImage) ? props : { ...props, image: undefined };

        // Extract OSM last modified timestamp
        let osmLastModified: Date | null = null;
        if (props["osm_last_modified"]) {
          const parsed = new Date(String(props["osm_last_modified"]));
          if (!isNaN(parsed.getTime())) {
            osmLastModified = parsed;
          }
        }

        // Source URL: prefer source:url, then first URL in source tag, then website as fallback.
        // website is always preserved in externalProperties, so both are accessible downstream.
        const firstUrlInSource =
          (props["source"] as string | undefined)
            ?.split(";")
            .map((s) => s.trim())
            .find((s) => s.startsWith("http")) ?? null;
        const sourceUrl =
          (props["source:url"] as string | undefined) ||
          firstUrlInSource ||
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

        pendingRows.push({
          name,
          description,
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
        });
      } catch (rowErr) {
        console.error(`Failed to build row for feature ${i}:`, rowErr);
        skipped++;
      }

      if (pendingRows.length >= UPSERT_BATCH_SIZE) {
        const { ok, fail } = await flushBatch(pendingRows);
        inserted += ok;
        skipped += fail;
        pendingRows.length = 0;
        console.log(`Progress: ${i + 1} / ${geojson.features.length}`);
      }
    }

    // Flush remaining rows
    if (pendingRows.length > 0) {
      const { ok, fail } = await flushBatch(pendingRows);
      inserted += ok;
      skipped += fail;
      pendingRows.length = 0;
    }

    globalInserted += inserted;
    globalSkipped += skipped;
    console.log(
      `Finished ${path.basename(geojsonPath)}. Inserted: ${inserted}, skipped: ${skipped}`,
    );
  }

  console.log(`\nDONE. Total Inserted: ${globalInserted}, Total Skipped: ${globalSkipped}`);

  // Compute geometry_size_m in a single bulk UPDATE across all newly imported/updated rows.
  // This avoids the double geometryJson parse that would occur inline per row, and lets
  // PostGIS pipeline geography computations (ST_Length, ST_Perimeter, ST_Distance) across
  // all rows in one efficient pass.
  // Spatial size in meters, used to:
  //   - decide zoom level when flying to a project
  //   - progressively hide center-point markers when the shape is large enough
  //   - drive the size filter slider in the UI
  // The cap is GREATEST(bbox_width, bbox_height), the longest side of the bounding box.
  // Using the bbox diagonal instead would inflate areas by up to sqrt(2) (~41%) for square shapes.
  // GREATEST(ST_Length, ST_Perimeter) handles both geometry families:
  //   - LineString/MultiLineString: ST_Length > 0, ST_Perimeter = 0
  //   - Polygon/MultiPolygon:       ST_Length = 0, ST_Perimeter > 0
  // Examples (lines):
  //   - A20 motorway (170km route, ~200km bbox diagonal): LEAST(170km, 200km) = 170km  correct
  //   - B96a (675m total, 7200m bbox diagonal):           LEAST(675m,  7200m) = 675m   correct
  // Examples (polygons):
  //   - 100x100m parking lot (400m perimeter):            LEAST(400m, 100m)   = 100m   correct
  //   - Circular park r=500m (3141m perimeter):           LEAST(3141m, 1000m) = 1000m  correct (diameter)
  // ST_Area > 0 discriminates polygons from lines (ST_Dimension is unreliable on GeometryCollection).
  console.log(`\nComputing geometry sizes for all imported rows (batched)...`);
  try {
    // Fetch IDs of all rows that need updating. This is cheap, no geography ops yet.
    const idsToUpdate = (
      await db.execute<{ id: string }>(sql`
        SELECT id
        FROM projects
        WHERE import_source_id = ${importSource.id}
          AND geometry IS NOT NULL
          AND geometry_size_m IS NULL
          AND last_imported_at >= ${syncStartTime.toISOString()}
      `)
    ).map((r) => r.id);

    console.log(`  ${idsToUpdate.length} rows to process`);

    const GEOMETRY_BATCH_SIZE = 2000;
    let sizesDone = 0;
    for (let offset = 0; offset < idsToUpdate.length; offset += GEOMETRY_BATCH_SIZE) {
      const batchIds = idsToUpdate.slice(offset, offset + GEOMETRY_BATCH_SIZE);
      const idList = sql.join(
        batchIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      await db.execute(sql`
        UPDATE projects AS p
        SET geometry_size_m = sizes.size
        FROM (
          SELECT id,
            CASE
              WHEN ST_Area(geometry) > 0 THEN
                LEAST(
                  ST_Perimeter(geometry::geography),
                  GREATEST(
                    ST_Distance(
                      ST_MakePoint(ST_XMin(env.e), ST_YMin(env.e))::geography,
                      ST_MakePoint(ST_XMax(env.e), ST_YMin(env.e))::geography
                    ),
                    ST_Distance(
                      ST_MakePoint(ST_XMin(env.e), ST_YMin(env.e))::geography,
                      ST_MakePoint(ST_XMin(env.e), ST_YMax(env.e))::geography
                    )
                  )
                )
              ELSE
                LEAST(
                  ST_Length(geometry::geography),
                  ST_Length(ST_BoundingDiagonal(env.e)::geography)
                )
            END AS size
          FROM projects, LATERAL (SELECT ST_Envelope(geometry) AS e) env
          WHERE id IN (${idList})
        ) AS sizes
        WHERE p.id = sizes.id
      `);
      sizesDone += batchIds.length;
      console.log(`  ${sizesDone} / ${idsToUpdate.length}`);
    }
    console.log(`Geometry sizes computed.`);
  } catch (err) {
    console.error("Failed to compute geometry sizes (non-fatal):", err);
  }

  // Replace the JS arithmetic centroid with ST_PointOnSurface so that lat/lng and
  // center_coordinate land on the geometry itself (e.g. the midpoint of a railroad line)
  // rather than the average of all coordinates, which can fall off curved or asymmetric shapes.
  // This is the anchor used for popup placement and tile-based navigation.
  console.log(`\nUpdating center coordinates to ST_PointOnSurface...`);
  try {
    await db.execute(sql`
      UPDATE projects
      SET
        lat               = ST_Y(ST_PointOnSurface(geometry)),
        lng               = ST_X(ST_PointOnSurface(geometry)),
        center_coordinate = ST_PointOnSurface(geometry)
      WHERE import_source_id = ${importSource.id}
        AND geometry IS NOT NULL
        AND last_imported_at >= ${syncStartTime.toISOString()}
    `);
    console.log(`Center coordinates updated.`);
  } catch (err) {
    console.error("Failed to update center coordinates (non-fatal):", err);
  }

  // Prune stale projects that were not updated during this sync.
  // Projects with overlays are soft-detached (import link severed, geometry cleared, overlays kept).
  // Projects without overlays are hard-deleted.
  console.log(`\nPruning stale projects not seen since ${syncStartTime.toISOString()}...`);
  const staleCondition = sql`import_source_id = ${importSource.id} AND (last_imported_at IS NULL OR last_imported_at < ${syncStartTime.toISOString()})`;
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

  // Refresh planner statistics after the large upsert/delete cycle.
  // The spatial columns (center_coordinate, geometry) use GIST indexes whose
  // selectivity estimates assume uniform geographic distribution, so they will
  // still under-count clustered regions, but scalar column stats (tags,
  // geometry_size_m, timeline_status) benefit meaningfully from a fresh ANALYZE.
  console.log(`Running ANALYZE on projects table...`);
  try {
    await db.execute(sql`ANALYZE projects`);
    console.log(`ANALYZE complete.`);
  } catch (err) {
    console.error("ANALYZE failed (non-fatal):", err);
  }

  console.log(`Import complete. Updated lastSyncAt for ${IMPORT_SOURCE_SLUG}`);
  await pgClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
