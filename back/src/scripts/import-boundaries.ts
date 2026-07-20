/**
 * Import OSM administrative boundaries into the admin_boundaries table.
 *
 * Input is the newline-delimited GeoJSON produced by scripts/osm-extract/extract_boundaries.sh
 * (one boundary Feature per line). Boundaries are upserted on osm_id; geometry is simplified
 * in PostGIS on the way in (coastline accuracy is not needed, only containment).
 *
 * After loading, set-based passes resolve the hierarchy and assignment:
 *   1. parent_id: the closest-level boundary that contains each boundary's representative point.
 *   2. country_code: propagated down the parent chain from each level-2 (ISO-tagged) root.
 *   3. projects: each project assigned to the boundary holding the majority of its shape.
 * The heavy spatial passes run in row-number batches that log throughput and ETA.
 *
 * Run extract_boundaries.sh first, then:
 *   bun run back/src/scripts/import-boundaries.ts <path-to.geojsonl>
 *
 * Runs three steps in order: load (parse + upsert + prune), hierarchy (parent_id + country_code),
 * assign (projects -> boundary). Re-run a subset with --steps; the geojsonl is only required when
 * `load` is selected. --only-unassigned scopes the assign step to projects that still have no
 * boundary (an incremental fill, skipping the already-assigned). Examples:
 *   bun run ...import-boundaries.ts --steps=assign                 # reassign all projects
 *   bun run ...import-boundaries.ts --steps=assign --only-unassigned  # fill only the missing ones
 *   bun run ...import-boundaries.ts --steps=hierarchy,assign       # rebuild hierarchy + reassign
 *   bun run ...import-boundaries.ts <path.geojsonl> --steps=load   # reload boundaries only
 */

import { drizzle } from "drizzle-orm/bun-sql";
import { SQL as BunSQL } from "bun";
import { adminBoundaries, importSources } from "../db/schema";
import {
  BOUNDARY_DOMINANCE_THRESHOLD,
  coverageFractionSql,
  projectEffectiveGeometrySql,
} from "../db/boundaryAssignment";
import { sql, eq, type SQL } from "drizzle-orm";
import { config } from "../config";
import * as fs from "node:fs";
import * as readline from "node:readline";
import * as path from "node:path";
import * as os from "node:os";

// The per-row geometry pipeline (GeoJSON parse + simplify + MakeValid) is CPU-bound in Postgres,
// so throughput scales with how many backends run it at once. Use half the host's cores so a
// neighbouring container (separate Postgres, shared host CPU/disk) keeps enough headroom to stay
// responsive. Paired with max_parallel_workers_per_gather=0 below: that keeps each backend
// single-threaded so this count is the real ceiling on cores consumed, rather than a floor each
// backend can exceed by fanning out into parallel workers.
const IMPORT_CONCURRENCY = Math.max(1, Math.floor(os.availableParallelism() / 2));

const importDatabaseUrl = new URL(config.DATABASE_URL);
const startupOptions = importDatabaseUrl.searchParams.get("options");
importDatabaseUrl.searchParams.set(
  "options",
  [startupOptions, "-c synchronous_commit=off -c max_parallel_workers_per_gather=0"]
    .filter(Boolean)
    .join(" "),
);
const sqlClient = new BunSQL(importDatabaseUrl.toString(), {
  max: IMPORT_CONCURRENCY,
});
const db = drizzle({ client: sqlClient });

// ~0.0005 degrees ≈ 55m at the equator. Drops vertex count by ~10x while staying well within
// the accuracy a project-to-boundary assignment needs.
const SIMPLIFY_TOLERANCE_DEG = 0.0005;

// Only admin levels worth keeping: 2=country .. 10=neighborhood. Levels outside this are noise
// (continents, supranational unions, sub-building divisions).
const MIN_ADMIN_LEVEL = 2;
const MAX_ADMIN_LEVEL = 10;

const UPSERT_BATCH_SIZE = 500;

// Load progress is logged once every this many rows (a multiple of UPSERT_BATCH_SIZE) to keep the
// terminal readable rather than emitting a line per batch.
const LOG_EVERY = 50000;

const IMPORT_SOURCE_SLUG = "osm_boundaries";
const IMPORT_SOURCE_CONFIG = {
  slug: IMPORT_SOURCE_SLUG,
  name: "OpenStreetMap Boundaries",
  type: "osm",
  urlTemplate: "https://www.openstreetmap.org/{id}",
  attribution: "© OpenStreetMap contributors",
  enabled: true,
};

function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

async function countRows(query: SQL): Promise<number> {
  const rows = (await db.execute(query)) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// Run `makeStatement` over the row-number range [1, total] in fixed-size slices, up to
// IMPORT_CONCURRENCY in flight at once over the pool, logging throughput and ETA as each slice
// returns. Splitting a long set-based pass into returning statements both lets it report progress
// (a single opaque UPDATE shows no rate) and lets independent slices run in parallel. Slices must
// touch disjoint rows for the concurrency to be safe, which the row-number ranges guarantee.
async function runBatched(
  label: string,
  total: number,
  batchSize: number,
  makeStatement: (startRn: number, endRn: number) => SQL,
): Promise<void> {
  if (total === 0) {
    log(`  ${label}: nothing to do`);
    return;
  }
  const startedAt = Date.now();
  let completed = 0;
  const failedRanges: Array<{ start: number; end: number }> = [];
  const inFlight = new Set<Promise<void>>();

  // A slice resolves even when its statement fails, so one error (a backend killed on a shared host,
  // a deadlock, or a row PostGIS chokes on) cannot reject Promise.race and abandon every remaining
  // slice. Retry once for the transient case, then record the range and let the run surface it at the
  // end rather than reporting a clean finish over silently unprocessed rows.
  async function runSlice(start: number, end: number): Promise<void> {
    try {
      await db.execute(makeStatement(start, end));
    } catch (error) {
      console.error(`  ${label}: batch rows (${start}, ${end}] failed, retrying once:`, error);
      try {
        await db.execute(makeStatement(start, end));
      } catch (retryError) {
        console.error(`  ${label}: batch rows (${start}, ${end}] failed again:`, retryError);
        failedRanges.push({ start, end });
        return;
      }
    }
    completed += 1;
    // Batches return out of order, so estimate progress from the count that have finished
    // rather than this slice's own end.
    const processed = Math.min(completed * batchSize, total);
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const rate = elapsedSec > 0 ? processed / elapsedSec : 0;
    const etaSec = rate > 0 ? (total - processed) / rate : 0;
    const pct = Math.floor((processed / total) * 100);
    log(
      `  ${label}: ${processed}/${total} (${pct}%, ${Math.round(rate)}/s, ETA ${formatDuration(etaSec)})`,
    );
  }

  for (let start = 0; start < total; start += batchSize) {
    const end = start + batchSize;
    const promise = runSlice(start, end).finally(() => {
      inFlight.delete(promise);
    });
    inFlight.add(promise);
    if (inFlight.size >= IMPORT_CONCURRENCY) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);

  if (failedRanges.length > 0) {
    const ranges = failedRanges.map((r) => `(${r.start}, ${r.end}]`).join(", ");
    throw new Error(
      `${label}: ${failedRanges.length} batch(es) failed after retry, leaving rows unprocessed: ` +
        `${ranges}. Re-run this step to fill them.`,
    );
  }
}

// Terminate any backend still running this import's statements. A hard-killed run leaves its
// server-side transactions holding row locks until Postgres notices the dead client, which it
// will not do while a long statement runs, so the next run blocks on those locks. The filter is
// scoped to import statements, so app connections are never touched. Concurrent imports are not
// supported (a second one would cancel the first); that is intentional.
async function terminateOrphanImportBackends(): Promise<number> {
  try {
    const killed = await db.execute(sql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND (query ILIKE '%into "admin_boundaries"%'
             OR query ILIKE '%UPDATE admin_boundaries%'
             OR query ILIKE '%boundary_points%'
             OR query ILIKE '%project_assign_queue%')
    `);
    return killed.length;
  } catch (error) {
    console.error("Failed to terminate orphaned backends:", error);
    return 0;
  }
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Received ${signal}, cancelling in-flight statements and releasing locks...`);
  // Cancel our own running statements server-side so locks drop now instead of lingering until
  // Postgres notices the closing client. Covers Ctrl-C; SIGKILL cannot run this, which is why the
  // startup guard exists as the real safety net.
  await terminateOrphanImportBackends();
  try {
    await sqlClient.end({ timeout: 5 });
  } catch {
    // already closing; nothing to do
  }
  process.exit(1);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

interface BoundaryRow {
  osmId: string;
  adminLevel: number;
  name: string;
  nameEn: string | null;
  names: Record<string, string> | null;
  countryCode: string | null;
  geomGeoJson: string;
  externalLastModified: Date | null;
}

// osmium --add-unique-id=type_id emits ids like "r1403916" / "w12345". Normalize to the
// "relation/1403916" form documented on the schema column.
function normalizeOsmId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length < 2) return null;
  const prefix = raw[0];
  const rest = raw.slice(1);
  if (prefix === "r") return `relation/${rest}`;
  if (prefix === "w") return `way/${rest}`;
  if (prefix === "n") return `node/${rest}`;
  return raw;
}

function parseFeature(line: string): BoundaryRow | null {
  // geojsonseq (RFC 8142) prefixes each record with an RS byte (0x1e); strip it before parsing.
  let trimmed = line.trim();
  if (trimmed.charCodeAt(0) === 0x1e) trimmed = trimmed.slice(1);
  if (!trimmed) return null;

  let feature: GeoJSON.Feature;
  try {
    feature = JSON.parse(trimmed) as GeoJSON.Feature;
  } catch {
    return null;
  }

  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const geometry = feature.geometry;
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
    return null;
  }

  const osmId = normalizeOsmId(feature.id ?? props["@id"]);
  if (!osmId) return null;

  const adminLevel = Number.parseInt(String(props["admin_level"] ?? ""), 10);
  if (Number.isNaN(adminLevel) || adminLevel < MIN_ADMIN_LEVEL || adminLevel > MAX_ADMIN_LEVEL) {
    return null;
  }

  const nameEn = typeof props["name:en"] === "string" ? (props["name:en"] as string) : null;
  const baseName = typeof props["name"] === "string" ? (props["name"] as string) : null;
  const name = baseName ?? nameEn;
  if (!name) return null; // A boundary with no name is useless for display

  // Collect every localized name (name:xx) into the names jsonb.
  const names: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("name:") && typeof value === "string") {
      names[key.slice("name:".length)] = value;
    }
  }

  // Country boundaries carry their ISO code; propagate it to descendants in the post-pass.
  const iso3 =
    typeof props["ISO3166-1:alpha3"] === "string" ? (props["ISO3166-1:alpha3"] as string) : null;

  // OSM object edit time, emitted as @timestamp by osmium export (see extract_boundaries.sh).
  // Null when the source PBF carries no metadata or the export omits it.
  const rawTimestamp = props["@timestamp"];
  let externalLastModified: Date | null = null;
  if (typeof rawTimestamp === "string") {
    const parsed = new Date(rawTimestamp);
    if (!Number.isNaN(parsed.getTime())) externalLastModified = parsed;
  }

  return {
    osmId,
    adminLevel,
    name,
    nameEn,
    names: Object.keys(names).length > 0 ? names : null,
    countryCode: iso3,
    geomGeoJson: JSON.stringify(geometry),
    externalLastModified,
  };
}

async function flushBatch(batch: BoundaryRow[], now: Date): Promise<void> {
  if (batch.length === 0) return;

  const values = batch.map((row) => ({
    osmId: row.osmId,
    adminLevel: row.adminLevel,
    name: row.name,
    nameEn: row.nameEn,
    names: row.names,
    countryCode: row.countryCode,
    // Simplify FIRST, then MakeValid on the reduced geometry: MakeValid cost scales with vertex
    // count, so validating the full-resolution polygon was the dominant cost. SimplifyPreserveTopology
    // tolerates minor input invalidity; the rare geometry it chokes on is caught by the per-row
    // fallback below. CollectionExtract(...,3) keeps polygonal parts, ST_Multi yields the MULTIPOLYGON.
    geom: sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(ST_SetSRID(ST_GeomFromGeoJSON(${row.geomGeoJson}), 4326), ${SIMPLIFY_TOLERANCE_DEG})), 3))`,
    externalLastModified: row.externalLastModified,
    lastImportedAt: now,
  }));

  try {
    await db
      .insert(adminBoundaries)
      .values(values)
      .onConflictDoUpdate({
        target: adminBoundaries.osmId,
        set: {
          adminLevel: sql`EXCLUDED.admin_level`,
          name: sql`EXCLUDED.name`,
          nameEn: sql`EXCLUDED.name_en`,
          names: sql`EXCLUDED.names`,
          countryCode: sql`EXCLUDED.country_code`,
          geom: sql`EXCLUDED.geom`,
          externalLastModified: sql`EXCLUDED.external_last_modified`,
          lastImportedAt: sql`EXCLUDED.last_imported_at`,
          updatedAt: now,
        },
      });
  } catch (error) {
    // Fall back to per-row inserts so one bad geometry doesn't discard the whole batch.
    console.error("Batch insert failed, retrying rows individually:", error);
    for (const value of values) {
      try {
        await db
          .insert(adminBoundaries)
          .values(value)
          .onConflictDoUpdate({
            target: adminBoundaries.osmId,
            set: {
              adminLevel: sql`EXCLUDED.admin_level`,
              name: sql`EXCLUDED.name`,
              nameEn: sql`EXCLUDED.name_en`,
              names: sql`EXCLUDED.names`,
              countryCode: sql`EXCLUDED.country_code`,
              geom: sql`EXCLUDED.geom`,
              externalLastModified: sql`EXCLUDED.external_last_modified`,
              lastImportedAt: sql`EXCLUDED.last_imported_at`,
              updatedAt: now,
            },
          });
      } catch (rowError) {
        console.error(`Failed to insert boundary ${value.osmId}:`, rowError);
      }
    }
  }
}

const PARENT_BATCH_SIZE = 20000;

// Link each boundary to its closest-level container (parent_id), then derive country_code from
// the hierarchy. parent_id is resolved spatially: one representative point per boundary (computed
// once into a helper table) tested against the GIST-indexed polygons, batched by row number so it
// reports throughput and ETA. country_code then flows from the level-2 roots (which already carry
// their own ISO tag from import) down the parent links via a recursive walk, no geometry needed,
// which is why country resolution is near-instant.
// A regular table (not TEMP) is used because the connection pool means follow-up statements may
// run on a different backend, which would not see a session-local temp table.
async function resolveHierarchy(): Promise<void> {
  try {
    log("Building representative points...");
    await db.execute(sql`DROP TABLE IF EXISTS boundary_points`);
    // Materialize the skeleton (osm_id + row number) without touching geometry first: this scan is
    // cheap, and the row numbers let the expensive interior-point computation run in concurrent
    // batches over the pool instead of one single-threaded CREATE TABLE AS.
    await db.execute(sql`
      CREATE TABLE boundary_points (
        osm_id text,
        admin_level integer,
        rn bigint,
        pt geometry(Point, 4326)
      )
    `);
    await db.execute(sql`
      INSERT INTO boundary_points (osm_id, admin_level, rn)
      SELECT osm_id, admin_level, row_number() OVER () FROM admin_boundaries
    `);
    await db.execute(sql`CREATE INDEX ON boundary_points (rn)`);
    const total = await countRows(sql`SELECT count(*)::int AS n FROM boundary_points`);

    // Fill the interior point. ST_PointOnSurface guarantees a point inside the polygon but is far
    // costlier than ST_Centroid; the centroid lands inside for the convex-ish majority of admin
    // polygons, so try it first and fall back to ST_PointOnSurface only where it falls outside
    // (concave shapes, MultiPolygons with detached islands). Batched so it runs concurrently.
    await runBatched(
      "rep_points",
      total,
      PARENT_BATCH_SIZE,
      (start, end) => sql`
      UPDATE boundary_points bp
      SET pt = CASE
        WHEN ST_Contains(b.geom, ST_Centroid(b.geom)) THEN ST_Centroid(b.geom)
        ELSE ST_PointOnSurface(b.geom)
      END
      FROM admin_boundaries b
      WHERE b.osm_id = bp.osm_id AND bp.rn > ${start} AND bp.rn <= ${end}
    `,
    );
    await db.execute(sql`ANALYZE boundary_points`);

    // parent_id = the closest-level boundary containing each point. Batched by row number rather
    // than admin level: the result is identical (a child's parent depends only on the boundaries
    // that contain its own point, not on processing order), but fixed-size slices give a steady
    // progress rate. DISTINCT ON keeps, per child, the containing boundary with the highest
    // admin_level below it (the closest ancestor).
    await runBatched(
      "parent_id",
      total,
      PARENT_BATCH_SIZE,
      (start, end) => sql`
      UPDATE admin_boundaries b
      SET parent_id = sub.parent
      FROM (
        SELECT DISTINCT ON (bp.osm_id) bp.osm_id AS child, p.osm_id AS parent
        FROM boundary_points bp
        JOIN admin_boundaries p ON ST_Contains(p.geom, bp.pt)
        WHERE bp.rn > ${start} AND bp.rn <= ${end}
          AND p.admin_level < bp.admin_level
        ORDER BY bp.osm_id, p.admin_level DESC
      ) sub
      WHERE b.osm_id = sub.child
    `,
    );

    await db.execute(sql`DROP TABLE IF EXISTS boundary_points`);

    log("Resolving country_code by walking the parent chain to its root...");
    const countryStart = Date.now();
    // Seed from every boundary that already carries an ISO code (countries, plus any sub-region
    // tagged with one), then push that code down through parent_id. Pure FK traversal over the
    // parent index, so it skips missing intermediate levels and costs seconds, not the minutes a
    // point-in-polygon scan of every boundary would. Boundaries whose chain never reaches an
    // ISO-tagged ancestor keep country_code NULL.
    const countryResult = await db.execute<{ count: number }>(sql`
      WITH RECURSIVE chain AS (
        SELECT osm_id, country_code
        FROM admin_boundaries
        WHERE country_code IS NOT NULL
        UNION ALL
        SELECT b.osm_id, c.country_code
        FROM admin_boundaries b
        JOIN chain c ON b.parent_id = c.osm_id
        WHERE b.country_code IS NULL
      ), updated AS (
        UPDATE admin_boundaries b
        SET country_code = chain.country_code
        FROM chain
        WHERE b.osm_id = chain.osm_id AND b.country_code IS NULL
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM updated
    `);
    log(
      `  country_code: stamped ${countryResult[0]?.count ?? 0} boundaries in ${formatDuration(
        (Date.now() - countryStart) / 1000,
      )}`,
    );
  } catch (error) {
    console.error("Failed to resolve boundary hierarchy:", error);
    throw error;
  }
}

const ASSIGN_BATCH_SIZE = 10000;

// Assign every located project to the boundary holding the majority of its shape (the rule lives
// in boundaryAssignment.ts). The spatial intersection over all projects is the heaviest pass, so
// it runs in row-number batches against a queue table (projects.id is a uuid, not range-friendly)
// that each report throughput and ETA.
async function assignProjects(onlyUnassigned: boolean): Promise<void> {
  try {
    // Scope the queue to projects still missing a boundary (--only-unassigned): an incremental fill
    // that skips the projects already assigned, instead of recomputing every located project.
    const scopeFilter = onlyUnassigned ? sql` AND admin_boundary_id IS NULL` : sql``;
    log(
      onlyUnassigned
        ? "Building project assignment queue (only projects without a boundary)..."
        : "Building project assignment queue...",
    );
    await db.execute(sql`DROP TABLE IF EXISTS project_assign_queue`);
    await db.execute(sql`
      CREATE TABLE project_assign_queue AS
      SELECT id, row_number() OVER () AS rn FROM projects
      WHERE center_coordinate IS NOT NULL${scopeFilter}
    `);
    await db.execute(sql`CREATE INDEX ON project_assign_queue (rn)`);
    const total = await countRows(sql`SELECT count(*)::int AS n FROM project_assign_queue`);

    log("Assigning projects to boundaries (majority-of-shape)...");
    await runBatched(
      "assign",
      total,
      ASSIGN_BATCH_SIZE,
      (start, end) => sql`
      UPDATE projects pr
      SET admin_boundary_id = chosen.boundary_id
      FROM (
        SELECT DISTINCT ON (c.project_id) c.project_id, c.boundary_id
        FROM (
          SELECT p.id AS project_id, b.osm_id AS boundary_id, b.admin_level,
                 ${sql.raw(coverageFractionSql("eff.geom"))} AS frac
          FROM project_assign_queue q
          JOIN projects p ON p.id = q.id
          JOIN LATERAL (SELECT ${sql.raw(projectEffectiveGeometrySql("p"))} AS geom OFFSET 0) eff ON true
          JOIN admin_boundaries b ON ST_Intersects(b.geom, eff.geom)
          WHERE q.rn > ${start} AND q.rn <= ${end}
        ) c
        WHERE c.frac >= ${BOUNDARY_DOMINANCE_THRESHOLD}
        ORDER BY c.project_id, c.admin_level DESC, c.frac DESC
      ) chosen
      WHERE pr.id = chosen.project_id
        AND pr.admin_boundary_id IS DISTINCT FROM chosen.boundary_id
    `,
    );

    await db.execute(sql`DROP TABLE IF EXISTS project_assign_queue`);
  } catch (error) {
    console.error("Failed to assign projects to boundaries:", error);
    throw error;
  }
}

// Parse and upsert the GeoJSON into admin_boundaries, prune rows that vanished from the source, and
// stamp the import_source sync timestamps. Self-contained: the import-source bookkeeping belongs to
// this step alone, so re-running only hierarchy/assign never touches it.
async function loadBoundaries(inputPath: string): Promise<void> {
  log(`synchronous_commit=off, batch size ${UPSERT_BATCH_SIZE}`);

  log(`Setting up import source: ${IMPORT_SOURCE_SLUG}`);
  let importSource = await db
    .select()
    .from(importSources)
    .where(eq(importSources.slug, IMPORT_SOURCE_SLUG))
    .limit(1)
    .then((rows) => rows[0]);

  if (!importSource) {
    const created = await db.insert(importSources).values(IMPORT_SOURCE_CONFIG).returning();
    importSource = created[0];
  }
  if (!importSource) {
    throw new Error(`Failed to create or retrieve import source: ${IMPORT_SOURCE_SLUG}`);
  }
  log(`Using import source: ${importSource.name} (id=${importSource.id})`);

  const syncStartTime = new Date();
  await db
    .update(importSources)
    .set({ lastSyncStartedAt: syncStartTime })
    .where(eq(importSources.id, importSource.id));

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath),
    crlfDelay: Infinity,
  });

  let batch: BoundaryRow[] = [];
  let imported = 0;
  let skipped = 0;

  // Keep up to IMPORT_CONCURRENCY batch upserts in flight at once. flushBatch handles its own
  // errors, so these promises never reject; we only await to bound how many run concurrently.
  const inFlight = new Set<Promise<void>>();
  async function dispatch(rows: BoundaryRow[]): Promise<void> {
    const promise = flushBatch(rows, syncStartTime).finally(() => {
      inFlight.delete(promise);
    });
    inFlight.add(promise);
    if (inFlight.size >= IMPORT_CONCURRENCY) await Promise.race(inFlight);
  }

  for await (const line of rl) {
    const row = parseFeature(line);
    if (!row) {
      if (line.trim()) skipped += 1;
      // Abort fast on the wrong file format instead of scanning millions of junk lines.
      if (imported === 0 && inFlight.size === 0 && batch.length === 0 && skipped >= 5000) {
        console.error(
          `Parsed 0 boundary features in the first ${skipped} non-empty lines. Expected one ` +
            `GeoJSON Feature per line (the .geojsonl from extract_boundaries.sh / osmium export).`,
        );
        process.exit(1);
      }
      continue;
    }
    batch.push(row);
    if (batch.length >= UPSERT_BATCH_SIZE) {
      await dispatch(batch);
      imported += batch.length;
      batch = [];
      // imported is always a multiple of UPSERT_BATCH_SIZE here, so this logs every LOG_EVERY rows
      // exactly. Keeps the load to a handful of lines instead of flooding the scrollback.
      if (imported % LOG_EVERY === 0)
        log(`Imported ${imported} boundaries (skipped ${skipped})...`);
    }
  }
  await dispatch(batch);
  imported += batch.length;
  await Promise.all(inFlight);
  log(`Loaded ${imported} boundaries total (skipped ${skipped})`);

  // Prune boundaries that vanished from the source since they would otherwise keep stale
  // geometry. Projects referencing a pruned boundary fall back to NULL (FK on delete set null).
  try {
    const pruned = await db.execute<{ count: number }>(sql`
      WITH deleted AS (
        DELETE FROM admin_boundaries
        WHERE last_imported_at < ${syncStartTime}
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted
    `);
    log(`Pruned stale boundaries: ${pruned[0]?.count ?? 0}`);
  } catch (error) {
    console.error("Failed to prune stale boundaries:", error);
  }

  await db
    .update(importSources)
    .set({ lastSyncAt: new Date() })
    .where(eq(importSources.id, importSource.id));
}

// The GIST index on geom is the hard dependency of every spatial pass: without it,
// ST_Contains/ST_Intersects fall back to a full scan per point (hours instead of seconds).
// schema.ts declares it, but drizzle does not emit sql.raw indexes into migrations, so it is
// ensured here. IF NOT EXISTS makes it idempotent and near-instant when already present, so the
// hierarchy/assign steps can ensure it themselves and run standalone without a preceding load.
async function ensureSpatialIndex(): Promise<void> {
  try {
    log("Ensuring spatial index on admin_boundaries.geom...");
    const indexStart = Date.now();
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_admin_boundaries_geom ON admin_boundaries USING GIST (geom)`,
    );
    log(`  spatial index ready in ${formatDuration((Date.now() - indexStart) / 1000)}`);
  } catch (error) {
    console.error("Failed to ensure spatial index:", error);
  }
}

type ImportStep = "load" | "hierarchy" | "assign";
// Canonical order; selected steps always run in this order so dependencies hold regardless of how
// they were listed on the command line.
const ALL_STEPS: readonly ImportStep[] = ["load", "hierarchy", "assign"];

function parseArgs(argv: string[]): {
  inputPath: string | undefined;
  steps: ImportStep[];
  onlyUnassigned: boolean;
} {
  let inputPath: string | undefined;
  let steps: ImportStep[] = [...ALL_STEPS];
  let onlyUnassigned = false;
  const valid = new Set<string>(ALL_STEPS);
  for (const arg of argv) {
    if (arg.startsWith("--steps=")) {
      const requested = arg
        .slice("--steps=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const invalid = requested.filter((s) => !valid.has(s));
      if (invalid.length > 0) {
        console.error(`Unknown step(s): ${invalid.join(", ")}. Valid: ${ALL_STEPS.join(", ")}`);
        process.exit(1);
      }
      steps = ALL_STEPS.filter((s) => requested.includes(s));
    } else if (arg === "--only-unassigned") {
      onlyUnassigned = true;
    } else if (!arg.startsWith("--") && inputPath === undefined) {
      inputPath = arg;
    }
  }
  return { inputPath, steps, onlyUnassigned };
}

async function main(): Promise<void> {
  const { inputPath, steps, onlyUnassigned } = parseArgs(process.argv.slice(2));
  const runLoad = steps.includes("load");
  const runHierarchy = steps.includes("hierarchy");
  const runAssign = steps.includes("assign");

  if (runLoad) {
    if (!inputPath) {
      console.error(
        "Usage: bun run back/src/scripts/import-boundaries.ts <path-to.geojsonl> " +
          "[--steps=load,hierarchy,assign]",
      );
      process.exit(1);
    }
    if (!fs.existsSync(inputPath)) {
      console.error(`Input file not found: ${path.resolve(inputPath)}`);
      process.exit(1);
    }
    // Guard against the common mistake of passing the filtered PBF instead of the exported GeoJSON.
    if (/\.pbf$/i.test(inputPath)) {
      console.error(
        `That is an OSM PBF. This importer reads the newline-delimited GeoJSON from the export step.\n` +
          `Produce it first with:\n` +
          `  osmium export ${inputPath} --geometry-types=polygon --add-unique-id=type_id \\\n` +
          `    --output-format=geojsonseq,print_record_separator=false \\\n` +
          `    --output ${inputPath.replace(/\.osm\.pbf$|\.pbf$/i, "")}.geojsonl --overwrite`,
      );
      process.exit(1);
    }
  }

  log(`Steps: ${steps.join(", ")}`);
  log(`Concurrency: ${IMPORT_CONCURRENCY} (half of ${os.availableParallelism()} cores)`);

  const orphans = await terminateOrphanImportBackends();
  if (orphans > 0) {
    log(`Cleared ${orphans} orphaned backend(s) holding locks from a previously killed run`);
  }

  if (runLoad && inputPath) await loadBoundaries(inputPath);

  // Every spatial pass depends on the GIST index; ensure it whenever one will run.
  if (runHierarchy || runAssign) await ensureSpatialIndex();

  if (runHierarchy) await resolveHierarchy();
  if (runAssign) await assignProjects(onlyUnassigned);

  log("Done.");
  await sqlClient.end();
  process.exit(0);
}

await main();
