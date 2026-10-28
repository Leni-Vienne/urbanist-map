/**
 * Import worldwide proposed/construction features GeoJSON into the projects table.
 * Projects are auto-approved and linked to the "osm_world" import source.
 * Existing projects are updated via upsert on (importSourceId, externalId).
 * Projects not seen in the current sync are automatically pruned.
 *
 * Covers railways, roads, aerialways, waterways, cycling and pedestrian paths,
 * buildings under construction, and parks/green spaces.
 */

import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import { projects, importSources, adminBoundaries } from "../db/schema";
import { boundaryForGeometrySql, projectEffectiveGeometrySql } from "../db/boundaryAssignment";
import { geometrySizeMSql } from "../db/geometrySize";
import { sql, eq, isNull } from "drizzle-orm";
import { config } from "../config";

// synchronous_commit=off lets commits return without waiting for the WAL fsync, which is the main
// cost of the thousands of small batch commits. Set as a startup parameter so every connection
// inherits it.
// The import is idempotent and replayable, so losing the last few commits to a crash is fine: re-run.
// max: 1 pins the whole run to a single backend connection. The script is fully sequential, so it
// loses no parallelism, and the prune's TEMP TABLE of seen ids is session-scoped: it must live on the
// same connection as the statements that read it.
const importDatabaseUrl = new URL(config.DATABASE_URL);
const startupOptions = importDatabaseUrl.searchParams.get("options");
importDatabaseUrl.searchParams.set(
  "options",
  [startupOptions, "-c synchronous_commit=off"].filter(Boolean).join(" "),
);
const sqlClient = new SQL(importDatabaseUrl.toString(), {
  max: 1,
});
const db = drizzle({ client: sqlClient });
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import {
  centroid,
  deriveSourceUrl,
  extractTags,
  mapTimelineStatus,
  parseOsmDate,
} from "./osmDerive";
import { buildProjectSlug } from "@shared/projectSlug";
import { refreshAllIndexable } from "../db/indexable";
import { computeOsmFeatureRevision, shouldSkipOsmFeature } from "./osmRevision";
import { logOsmEvent } from "./osmLog";

// Manual imports use the repository's worldwide extract from any working directory.
// The updater supplies its prefix so extraction and import always use the same files.
const { values: options } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "input-prefix": {
      type: "string",
      default: path.resolve(import.meta.dir, "../../../scripts/osm-extract/planet-latest_proposed"),
    },
    full: { type: "boolean", default: false },
  },
});
const GEOJSON_PATHS = [
  `${options["input-prefix"]}_linear.geojson`,
  `${options["input-prefix"]}_areal.geojson`,
];

// A large batch cuts the commit (and thus fsync) count. Each row binds ~22 params, so 1000 rows =
// ~22k params, well under Postgres' 65535 bind-parameter limit per statement.
const UPSERT_BATCH_SIZE = 1000;

// Set --full (or OSM_FULL_REIMPORT=1) to bypass the unchanged-row skip and re-derive every feature.
// Use it after changing importer-only derivation logic (date parsing, source-url rules, etc.) when the
// source feature and therefore its revision did not change.
const FULL_REIMPORT = options.full || process.env.OSM_FULL_REIMPORT === "1";

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

const log = logOsmEvent.bind(null, "import_osm");

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
        FROM admin_boundaries
        WHERE country_code IS NOT NULL
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(input.lng::float8, input.lat::float8), 4326)
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
      log("db_restored");
      return;
    } catch {
      log("db_retry", { delay_seconds: delay / 1000 }, "warning");
      delay = Math.min(delay * 2, 30_000);
    }
  }
  throw new Error("Database did not become available within the timeout period.");
}

// Flush a batch of rows to the database via a single multi-row upsert.
// Falls back to individual inserts if the batch fails (e.g. bad geometry on one row).
// Retries the whole batch if a transient connection error is detected.
// eslint-disable-next-line no-explicit-any
async function flushBatch(batch: any[]): Promise<{ ok: number; fail: number }> {
  if (batch.length === 0) return { ok: 0, fail: 0 };
  // Rows with import_locked_at set carry a moderator-approved user edit; the upsert skips them
  // (setWhere below) so OSM can't overwrite that edit. The prune likewise leaves them alone.
  const conflictSet = {
    name: sql`EXCLUDED.name`,
    description: sql`EXCLUDED.description`,
    countryCode: sql`EXCLUDED.country_code`,
    timelineStatus: sql`EXCLUDED.timeline_status`,
    externalProperties: sql`EXCLUDED.external_properties`,
    externalLastModified: sql`EXCLUDED.external_last_modified`,
    externalRevision: sql`EXCLUDED.external_revision`,
    lastImportedAt: sql`EXCLUDED.last_imported_at`,
    tags: sql`EXCLUDED.tags`,
    sourceUrl: sql`EXCLUDED.source_url`,
    startDate: sql`EXCLUDED.start_date`,
    startDatePrecision: sql`EXCLUDED.start_date_precision`,
    endDate: sql`EXCLUDED.end_date`,
    endDatePrecision: sql`EXCLUDED.end_date_precision`,
    geometry: sql`EXCLUDED.geometry`,
    // lat/lng/center_coordinate carry the JS arithmetic centroid here. When geometry is unchanged
    // we keep the existing value, which the post-import pass already corrected to ST_PointOnSurface;
    // overwriting it would flip the anchor back to the arithmetic centroid every run. When geometry
    // changes we take the new arithmetic centroid, then the post-import pass corrects it.
    lat: sql`CASE WHEN projects.geometry IS DISTINCT FROM EXCLUDED.geometry THEN EXCLUDED.lat ELSE projects.lat END`,
    lng: sql`CASE WHEN projects.geometry IS DISTINCT FROM EXCLUDED.geometry THEN EXCLUDED.lng ELSE projects.lng END`,
    centerCoordinate: sql`CASE WHEN projects.geometry IS DISTINCT FROM EXCLUDED.geometry THEN EXCLUDED.center_coordinate ELSE projects.center_coordinate END`,
    // Reset geometry_size_m to NULL when geometry changes so it gets recomputed below.
    // Keeps the existing value when geometry is unchanged to avoid redundant PostGIS work.
    geometrySizeM: sql`CASE WHEN projects.geometry IS DISTINCT FROM EXCLUDED.geometry THEN NULL ELSE projects.geometry_size_m END`,
    // Override Drizzle's $onUpdate auto-bump so updated_at only moves when a meaningful field
    // actually changed. Without this, every daily run would touch updated_at on every row.
    // external_revision and last_imported_at are importer bookkeeping and intentionally excluded.
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
        setWhere: isNull(projects.importLockedAt),
      });
    return { ok: batch.length, fail: 0 };
  } catch (batchErr) {
    if (isTransient(batchErr)) {
      log("batch_retry", { rows: batch.length, error: batchErr }, "warning");
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
            setWhere: isNull(projects.importLockedAt),
          });
        ok++;
      } catch (rowErr) {
        if (isTransient(rowErr)) {
          log("row_retry", { external_id: row.externalId, error: rowErr }, "warning");
          await waitForDb();
          try {
            await db
              .insert(projects)
              .values(row)
              .onConflictDoUpdate({
                target: [projects.importSourceId, projects.externalId],
                set: conflictSet,
                setWhere: isNull(projects.importLockedAt),
              });
            ok++;
          } catch (retryErr) {
            log(
              "row_failed",
              { external_id: row.externalId, error: retryErr, retried: true },
              "error",
            );
            fail++;
          }
        } else {
          log("row_failed", { external_id: row.externalId, error: rowErr }, "error");
          fail++;
        }
      }
    }
    return { ok, fail };
  }
}

async function main() {
  const started = performance.now();
  // Both files form one worldwide sync. Skipping a missing file would let pruning
  // delete its projects after successfully importing the other file.
  for (const geojsonPath of GEOJSON_PATHS) {
    fs.accessSync(geojsonPath, fs.constants.R_OK);
  }

  log("import_started", {
    batch_size: UPSERT_BATCH_SIZE,
    full_reimport: FULL_REIMPORT,
    input_prefix: options["input-prefix"],
  });
  let importSource = await db
    .select()
    .from(importSources)
    .where(eq(importSources.slug, IMPORT_SOURCE_SLUG))
    .limit(1)
    .then((rows) => rows[0]);

  if (!importSource) {
    log("source_creating", { source: IMPORT_SOURCE_SLUG });
    const created = await db.insert(importSources).values(IMPORT_SOURCE_CONFIG).returning();
    importSource = created[0];
  }

  if (!importSource) {
    throw new Error(`Failed to create or retrieve import source: ${IMPORT_SOURCE_SLUG}`);
  }

  log("source_resolved", { source: IMPORT_SOURCE_SLUG, source_id: importSource.id });

  // Country codes come from the admin boundaries, which are also what the nearest-boundary lookup
  // searches. With none loaded, every feature would fail to resolve a country, and failing to
  // resolve drops the feature from this sync entirely: the run would delete the whole OSM corpus.
  // Refuse to proceed instead.
  const validCountryCodes = new Set(
    (
      await db
        .selectDistinct({ code: adminBoundaries.countryCode })
        .from(adminBoundaries)
        .where(sql`${adminBoundaries.countryCode} IS NOT NULL`)
    )
      .map((r) => r.code)
      .filter((code): code is string => code !== null),
  );
  if (validCountryCodes.size === 0) {
    throw new Error(
      "No admin boundaries carry a country code. Run import-boundaries before importing OSM features.",
    );
  }
  log("countries_loaded", { countries: validCountryCodes.size });

  // Preload externalId -> countryCode for rows already resolved in a prior run. A nearest-boundary
  // KNN is the dominant per-run cost, so we only resolve new features below and reuse this for the
  // rest. Tradeoff: a feature whose geometry drifts across a border keeps its old country until
  // something forces re-resolution; acceptable since the country is already an approximation.
  const existingCountryByExternalId = new Map<string, string>();
  const existingRevisionByExternalId = new Map<string, string>();
  try {
    const existing = await db
      .select({
        externalId: projects.externalId,
        countryCode: projects.countryCode,
        externalRevision: projects.externalRevision,
      })
      .from(projects)
      .where(
        sql`${projects.importSourceId} = ${importSource.id} AND ${projects.externalId} IS NOT NULL`,
      );
    for (const row of existing) {
      if (!row.externalId) continue;
      if (row.countryCode) existingCountryByExternalId.set(row.externalId, row.countryCode);
      if (row.externalRevision)
        existingRevisionByExternalId.set(row.externalId, row.externalRevision);
    }
  } catch (err) {
    log("preload_failed", { error: err, fallback: "resolve_and_upsert_all" }, "warning");
  }
  log("projects_preloaded", {
    country_codes: existingCountryByExternalId.size,
    revisions: existingRevisionByExternalId.size,
  });

  // Record sync start time for pruning stale data later
  const syncStartTime = new Date();
  await db
    .update(importSources)
    .set({ lastSyncStartedAt: syncStartTime })
    .where(eq(importSources.id, importSource.id));

  let globalInserted = 0;
  let globalSkipped = 0;
  let globalUnchanged = 0;
  // Every external_id present and valid in this sync (new, edited, or unchanged-and-skipped). The prune
  // deletes/detaches OSM rows absent from this set, replacing the old last_imported_at timestamp check,
  // so unchanged rows can be skipped in the build loop without being mistaken for stale.
  const seenExternalIds: string[] = [];
  const encounteredExternalIds = new Set<string>();
  const duplicateExternalIds = new Set<string>();

  for (const geojsonPath of GEOJSON_PATHS) {
    const fileStarted = performance.now();
    const file = path.basename(geojsonPath);
    const geojson = JSON.parse(fs.readFileSync(geojsonPath, "utf8")) as GeoJSON.FeatureCollection;
    log("file_started", { file, features: geojson.features.length });

    const allStatuses = new Map<string, number>();
    let noName = 0,
      noEndDate = 0,
      noStartDate = 0,
      noTags = 0;
    const revisions = geojson.features.map(computeOsmFeatureRevision);
    const unchangedFeatures = geojson.features.map((feature, index) => {
      const externalId = feature.id ? String(feature.id) : null;
      return Boolean(
        externalId &&
        shouldSkipOsmFeature(
          existingRevisionByExternalId.get(externalId),
          revisions[index]!,
          FULL_REIMPORT,
        ),
      );
    });

    let inserted = 0;
    let skipped = 0;
    let unchanged = 0;
    // Features left un-upserted because no country could be resolved, sampled so a run that starts
    // discarding real data names the features instead of only counting them.
    let skippedUnresolvedCountry = 0;
    const skippedCountrySamples: string[] = [];

    // Resolve countryCode for each feature before the upsert loop. Reuse the preloaded value when the
    // feature already exists, and only feed the misses (new features) into the KNN lookup.
    const countryCodes: Array<string | null> = new Array(geojson.features.length).fill(null);
    const centroidsToResolve: Array<{ lat: number; lng: number } | null> = new Array(
      geojson.features.length,
    ).fill(null);
    let reusedCount = 0;
    let knnCount = 0;
    for (let i = 0; i < geojson.features.length; i++) {
      const f = geojson.features[i]!;
      if (unchangedFeatures[i]) continue;
      const externalId = f.id ? String(f.id) : null;
      const cached = externalId ? existingCountryByExternalId.get(externalId) : undefined;
      if (cached) {
        countryCodes[i] = cached;
        reusedCount++;
        continue;
      }
      const geom = f.geometry as GeoJSON.Geometry | null;
      centroidsToResolve[i] = geom ? centroid(geom) : null;
      knnCount++;
    }
    const resolved = await resolveCountryCodes(centroidsToResolve);
    for (let i = 0; i < resolved.length; i++) {
      if (countryCodes[i] == null) countryCodes[i] = resolved[i] ?? null;
    }
    log("countries_resolved", {
      file,
      reused: reusedCount,
      checked: knnCount,
      unchanged: unchangedFeatures.filter(Boolean).length,
    });

    // Build rows and flush in batches.
    // geometrySizeM is intentionally omitted here, it is computed in a single bulk UPDATE after all
    // files are processed, which avoids parsing geometryJson twice per row and lets PostGIS pipeline
    // the geography computations across all rows in one pass.
    // any[] because SQL<unknown> expressions for geometry/centerCoordinate are valid at runtime
    // but not assignable to the strict $inferInsert column types
    // eslint-disable-next-line no-explicit-any
    const pendingRows: any[] = [];

    for (let i = 0; i < geojson.features.length; i++) {
      const feature = geojson.features[i]!;
      const featureProps = feature.properties ?? {};
      const externalId = feature.id ? String(feature.id) : null;
      const encounteredInRun = externalId !== null && encounteredExternalIds.has(externalId);
      if (externalId !== null) {
        if (encounteredInRun) duplicateExternalIds.add(externalId);
        encounteredExternalIds.add(externalId);
      }

      // Count every input feature, including revision matches. Reuse these
      // derivations below instead of computing them again for changed rows.
      const props = featureProps;
      const name = (props["display_name"] as string | undefined)?.trim() || null;
      const tags = extractTags(props);
      const endParsed = parseOsmDate(props["opening_date"]) ?? parseOsmDate(props["end_date"]);
      const startParsed =
        parseOsmDate(props["start_date"]) ?? parseOsmDate(props["construction_start_expected"]);
      const status = String(props["project_status"] ?? "missing");
      allStatuses.set(status, (allStatuses.get(status) ?? 0) + 1);
      if (!name) noName++;
      if (!endParsed) noEndDate++;
      if (!startParsed) noStartDate++;
      if (tags.length === 0) noTags++;

      if (unchangedFeatures[i]) {
        if (externalId) seenExternalIds.push(externalId);
        unchanged++;
        continue;
      }

      // OSM edit timestamp is retained for display, filtering, and feed ordering.
      let osmLastModified: Date | null = null;
      if (featureProps["osm_last_modified"]) {
        const parsed = new Date(String(featureProps["osm_last_modified"]));
        if (!isNaN(parsed.getTime())) osmLastModified = parsed;
      }

      try {
        const description = (props["description"] as string | undefined)?.trim() || null;
        const countryCode = countryCodes[i] ?? null;
        if (!countryCode) {
          // Counted as seen so the prune leaves any existing row alone: the feature is present in
          // this extract, only its country is underivable, and dropping the row would lose data the
          // previous run resolved.
          if (externalId) seenExternalIds.push(externalId);
          skippedUnresolvedCountry++;
          if (skippedCountrySamples.length < 10 && externalId) {
            skippedCountrySamples.push(externalId);
          }
          skipped++;
          continue;
        }

        // Map OSM project_status to our timeline status
        const timelineStatus = mapTimelineStatus(props["project_status"] as string | undefined);

        // Store all OSM properties as JSON, stripping any image URL that isn't http/https
        const rawImage = (props["image"] as string | undefined)?.trim() ?? "";
        const externalProperties =
          rawImage && /^https?:\/\//.test(rawImage) ? props : { ...props, image: undefined };

        // website is always preserved in externalProperties, so both are accessible downstream.
        const sourceUrl = deriveSourceUrl(props);

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
          // Permanent, id-derived slug. Excluded from conflictSet below so it is frozen on first
          // insert and never recomputed (even after detach nulls externalId). Left null for the rare
          // id-less feature (no stable natural key to derive a unique, reproducible suffix from).
          slug: externalId ? buildProjectSlug({ name, externalId, id: null }) : null,
          description,
          countryCode,
          status: "approved" as const,
          timelineStatus,
          importSourceId: importSource.id,
          externalId,
          externalProperties,
          externalLastModified: osmLastModified,
          externalRevision: revisions[i]!,
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
        // Record a present, valid feature as seen so the prune keeps it. id-less rows can't be tracked
        // by external_id, so they are left out (the prune excludes external_id IS NULL rows anyway).
        if (externalId) seenExternalIds.push(externalId);
      } catch (rowErr) {
        log(
          "row_build_failed",
          { file, feature_index: i, external_id: externalId, error: rowErr },
          "error",
        );
        skipped++;
      }

      if (pendingRows.length >= UPSERT_BATCH_SIZE) {
        const { ok, fail } = await flushBatch(pendingRows);
        inserted += ok;
        skipped += fail;
        pendingRows.length = 0;
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
    globalUnchanged += unchanged;
    log("file_completed", {
      file,
      features: geojson.features.length,
      upserted: inserted,
      unchanged,
      skipped,
      duration_seconds: (performance.now() - fileStarted) / 1000,
      project_status: Object.fromEntries(allStatuses),
      missing_name: noName,
      missing_end_date: noEndDate,
      missing_start_date: noStartDate,
      missing_tags: noTags,
    });

    if (skippedUnresolvedCountry > 0) {
      log(
        "country_unresolved",
        {
          file,
          skipped: skippedUnresolvedCountry,
          sample_ids: skippedCountrySamples,
        },
        "warning",
      );
    }
  }

  if (duplicateExternalIds.size > 0) {
    log(
      "duplicate_ids",
      {
        duplicates: duplicateExternalIds.size,
        sample_ids: [...duplicateExternalIds].slice(0, 10),
      },
      "warning",
    );
  }

  // Compute geometry_size_m and the lat/lng/center_coordinate anchor in a single bulk UPDATE over
  // the changed/new rows. This avoids the double geometryJson parse that would occur inline per row,
  // and lets PostGIS pipeline the geography computations across all rows in one efficient pass.
  // The anchor uses ST_PointOnSurface so lat/lng and center_coordinate land on the geometry itself
  // (e.g. the midpoint of a railroad line) rather than the JS arithmetic centroid set during upsert,
  // which can fall off curved or asymmetric shapes. It is what marker placement and tile-based
  // navigation snap to. Unchanged rows keep the anchor a prior run already computed (see conflictSet).
  log("geometry_started");
  // New or geometry-changed rows: geometry_size_m IS NULL means the upsert nulled it on a geometry
  // change, or the row is new. This is exactly the set whose size, anchor AND admin boundary need
  // (re)computing, so it is captured once here and reused by the boundary-assignment pass below.
  let changedRowIds: string[] = [];
  try {
    changedRowIds = (
      await db.execute<{ id: string }>(sql`
        SELECT id
        FROM projects
        WHERE import_source_id = ${importSource.id}
          AND geometry IS NOT NULL
          AND geometry_size_m IS NULL
          AND last_imported_at >= ${syncStartTime.toISOString()}
      `)
    ).map((r) => r.id);

    log("geometry_rows", { rows: changedRowIds.length });

    const GEOMETRY_BATCH_SIZE = 2000;
    for (let offset = 0; offset < changedRowIds.length; offset += GEOMETRY_BATCH_SIZE) {
      const batchIds = changedRowIds.slice(offset, offset + GEOMETRY_BATCH_SIZE);
      const idList = sql.join(
        batchIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      await db.execute(sql`
        UPDATE projects AS p
        SET geometry_size_m = sizes.size,
            lat               = ST_Y(sizes.anchor),
            lng               = ST_X(sizes.anchor),
            center_coordinate = sizes.anchor
        FROM (
          SELECT id,
            ST_PointOnSurface(geometry) AS anchor,
            ${sql.raw(geometrySizeMSql("geometry", "env.e"))} AS size
          FROM projects, LATERAL (SELECT ST_Envelope(geometry) AS e) env
          WHERE id IN (${idList})
        ) AS sizes
        WHERE p.id = sizes.id
      `);
    }
    log("geometry_completed", { rows: changedRowIds.length });
  } catch (err) {
    log("geometry_failed", { error: err }, "warning");
  }

  // Re-assign new and geometry-changed projects to their admin boundary (the majority-of-shape rule
  // lives in boundaryAssignment.ts). import-osm only resolves the flat country_code inline; the deep
  // admin_boundary_id is derived from the project's effective geometry, so it must be recomputed for
  // exactly the rows inserted or whose geometry changed this run (changedRowIds). The user-submission
  // and overlay-approval paths assign one project at a time; this is the bulk equivalent for the OSM
  // sync, mirroring import-boundaries' own assign pass but scoped to an id list instead of all rows.
  // Best-effort: a failure here must not fail the import.
  if (changedRowIds.length > 0) {
    const boundariesStarted = performance.now();
    log("boundaries_started", { rows: changedRowIds.length });
    const BOUNDARY_BATCH_SIZE = 2000;
    try {
      for (let offset = 0; offset < changedRowIds.length; offset += BOUNDARY_BATCH_SIZE) {
        const batchStarted = performance.now();
        const batchIds = changedRowIds.slice(offset, offset + BOUNDARY_BATCH_SIZE);
        const idList = sql.join(
          batchIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        );
        await db.execute(sql`
          UPDATE projects pr
          SET admin_boundary_id = chosen.boundary_id
          FROM (
            SELECT p.id AS project_id, boundary.boundary_id
            FROM projects p
            JOIN LATERAL (SELECT ${sql.raw(projectEffectiveGeometrySql("p"))} AS geom OFFSET 0) eff ON true
            LEFT JOIN LATERAL (${boundaryForGeometrySql("eff.geom")}) boundary ON true
            WHERE p.id IN (${idList})
          ) chosen
          WHERE pr.id = chosen.project_id
            AND pr.admin_boundary_id IS DISTINCT FROM chosen.boundary_id
        `);
        log("boundaries_batch_completed", {
          rows: batchIds.length,
          processed: offset + batchIds.length,
          total: changedRowIds.length,
          duration_seconds: (performance.now() - batchStarted) / 1000,
        });
      }
      log("boundaries_completed", {
        rows: changedRowIds.length,
        duration_seconds: (performance.now() - boundariesStarted) / 1000,
      });
    } catch (err) {
      log("boundaries_failed", { error: err }, "warning");
    }
  }

  // Prune OSM projects absent from this sync (their external_id is not in this run's seen-id set).
  // Projects with overlays are soft-detached: the OSM link (import source + external id) is severed,
  // but geometry and external_properties are kept so the project keeps its shape and its osm_ids stay
  // available for later re-linking to a redrawn OSM feature. The frontend gates OSM attribution on
  // import_source_id, so a severed project shows no stale OSM link despite retaining the raw properties.
  // Projects without overlays are hard-deleted.
  // import_locked_at rows are exempt (staleCondition requires import_locked_at IS NULL): they hold an
  // approved user edit and must never be deleted or detached by the sync.
  log("prune_started");

  // Presence is tracked by a temp table of this run's seen external_ids rather than a per-row
  // last_imported_at bump, so unchanged rows are never rewritten. Built on the single pinned connection
  // (sqlClient max: 1) so the prune statements below can read it. If it can't be built in full, or it
  // came back empty, the prune is skipped entirely: deleting against a partial set would remove rows
  // that are actually present.
  let pruneSafe = false;
  try {
    await db.execute(sql`CREATE TEMP TABLE seen_external_ids (external_id text PRIMARY KEY)`);
    const SEEN_INSERT_CHUNK = 5000;
    for (let off = 0; off < seenExternalIds.length; off += SEEN_INSERT_CHUNK) {
      const chunk = seenExternalIds.slice(off, off + SEEN_INSERT_CHUNK);
      const values = sql.join(
        chunk.map((id) => sql`(${id})`),
        sql`, `,
      );
      await db.execute(
        sql`INSERT INTO seen_external_ids (external_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      );
    }
    pruneSafe = seenExternalIds.length > 0;
    log("seen_ids_loaded", { features: seenExternalIds.length, prune_enabled: pruneSafe });
  } catch (err) {
    log("prune_skipped", { reason: "seen_ids_failed", error: err }, "warning");
  }

  const staleCondition = sql`import_source_id = ${importSource.id} AND import_locked_at IS NULL AND external_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM seen_external_ids s WHERE s.external_id = projects.external_id)`;
  const hasOverlays = sql`EXISTS (SELECT 1 FROM overlays WHERE project_id = projects.id)`;

  if (pruneSafe) {
    try {
      // Preserve every public /project/:slug link before deletion: return 410 and let the SPA
      // center on its last known location. Indexability is a current SEO decision, not a history
      // of which URLs were public or shared, so it must not gate link preservation. Only approved
      // projects get a public fallback. A feature leaving the extract most often got built,
      // so retain the existing 'completed' default. ON CONFLICT refreshes a recurring slug.
      await db.execute(sql`
        INSERT INTO deleted_projects (slug, lat, lng, status, deleted_at)
        SELECT slug, lat, lng, 'completed', NOW()
        FROM projects
        WHERE ${staleCondition} AND NOT (${hasOverlays}) AND slug IS NOT NULL AND status = 'approved'
        ON CONFLICT (slug) DO UPDATE
          SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, status = EXCLUDED.status, deleted_at = NOW()
      `);

      const hardDeleted = await db
        .delete(projects)
        .where(sql`${staleCondition} AND NOT (${hasOverlays})`)
        .returning({ id: projects.id });
      log("cleanup_completed", { action: "hard_deleted", projects: hardDeleted.length });
    } catch (err) {
      log("cleanup_failed", { action: "hard_deleted", error: err }, "warning");
    }

    try {
      const softDetached = await db
        .update(projects)
        .set({
          detachedAt: new Date(),
          importSourceId: null,
          externalId: null,
          externalLastModified: null,
          externalRevision: null,
        })
        .where(sql`${staleCondition} AND detached_at IS NULL AND (${hasOverlays})`)
        .returning({ id: projects.id });
      log("cleanup_completed", { action: "soft_detached", projects: softDetached.length });
    } catch (err) {
      log("cleanup_failed", { action: "soft_detached", error: err }, "warning");
    }

    // Drop tombstones whose slug is live again: a reappearing OSM feature regenerates the same
    // deterministic slug, so the live row now wins and the stale tombstone would only mislead.
    try {
      await db.execute(
        sql`DELETE FROM deleted_projects WHERE slug IN (SELECT slug FROM projects WHERE slug IS NOT NULL)`,
      );
    } catch (err) {
      log("cleanup_failed", { action: "resurrected_tombstones", error: err }, "warning");
    }
  }

  // Recompute the SEO indexable flag across all rows now that inserts, detaches and prunes are done.
  log("indexable_started");
  await refreshAllIndexable(db);
  log("indexable_completed");

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
  log("analyze_started");
  try {
    await db.execute(sql`ANALYZE projects`);
    log("analyze_completed");
  } catch (err) {
    log("analyze_failed", { error: err }, "warning");
  }

  await sqlClient.end();
  log("import_completed", {
    source: IMPORT_SOURCE_SLUG,
    upserted: globalInserted,
    unchanged: globalUnchanged,
    skipped: globalSkipped,
    duration_seconds: (performance.now() - started) / 1000,
  });
  // Importing boundaryAssignment transitively constructs the app's main + tile pools (database.ts),
  // which this script never queries. Exit explicitly so an idle pool can't keep the process alive.
  process.exit(0);
}

main().catch((err) => {
  log("import_failed", { error: err }, "error");
  process.exit(1);
});
