/**
 * Snapshot stats for the projects table, with before/after diff support.
 *
 * Usage:
 *   bun run back/src/scripts/projects-stats.ts         , print current stats
 *   bun run back/src/scripts/projects-stats.ts save    , save snapshot to disk
 *   bun run back/src/scripts/projects-stats.ts diff    , diff current state against saved snapshot
 */

import { db } from "../database";
import { sql } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";

const SNAPSHOT_PATH = path.join(process.cwd(), "back/src/scripts/projects-stats-snapshot.json");

type Distribution = Record<string, number>;

interface Snapshot {
  timestamp: string;
  total: number;
  osm: number;
  userSubmitted: number;
  detached: number;
  projectShape: Distribution;
  approvalStatus: Distribution;
  timelineStatus: Distribution;
  tags: Distribution;
  tagsPerProject: Distribution;
  countries: Distribution;
  importSources: Distribution;
  completeness: Record<string, number>;
  geometrySize: Distribution;
  osmIdTypes: Distribution;
}

async function queryDistribution(
  query: ReturnType<typeof sql>,
  labelCol: string,
): Promise<Distribution> {
  const rows = await db.execute<Record<string, string>>(query);
  const out: Distribution = {};
  for (const row of rows) {
    out[row[labelCol]!] = Number(row.count);
  }
  return out;
}

async function collectSnapshot(): Promise<Snapshot> {
  const totalsRaw = await db.execute<{
    total: string;
    osm: string;
    user_submitted: string;
    detached: string;
  }>(sql`
    SELECT
      COUNT(*)                                                              AS total,
      COUNT(*) FILTER (WHERE import_source_id IS NOT NULL)                 AS osm,
      COUNT(*) FILTER (WHERE import_source_id IS NULL AND detached_at IS NULL) AS user_submitted,
      COUNT(*) FILTER (WHERE detached_at IS NOT NULL)                      AS detached
    FROM projects
  `);
  const t = totalsRaw[0]!;
  const total = Number(t.total);

  // The DB has no project-type column, so classify each project by what its
  // geometry collection actually contains: only lines (linear), only polygons
  // (areal), both (mixed), or nothing.
  const shapeRaw = await db.execute<{ shape: string; count: string }>(sql`
    SELECT shape, COUNT(*) AS count
    FROM (
      SELECT
        CASE
          WHEN p.geometry IS NULL THEN '(no geometry)'
          WHEN bool_or(GeometryType(d.geom) LIKE '%LINESTRING')
           AND bool_or(GeometryType(d.geom) LIKE '%POLYGON')    THEN 'mixed'
          WHEN bool_or(GeometryType(d.geom) LIKE '%LINESTRING')  THEN 'linear'
          WHEN bool_or(GeometryType(d.geom) LIKE '%POLYGON')     THEN 'areal'
          ELSE 'other'
        END AS shape
      FROM projects p
      LEFT JOIN LATERAL ST_Dump(p.geometry) AS d ON TRUE
      GROUP BY p.id, p.geometry
    ) sub
    GROUP BY shape
    ORDER BY count DESC
  `);
  const projectShape: Distribution = {};
  for (const r of shapeRaw) projectShape[r.shape] = Number(r.count);

  const approvalStatus = await queryDistribution(
    sql`SELECT status, COUNT(*) AS count FROM projects GROUP BY status ORDER BY count DESC`,
    "status",
  );

  const timelineStatus = await queryDistribution(
    sql`SELECT timeline_status, COUNT(*) AS count FROM projects GROUP BY timeline_status ORDER BY count DESC`,
    "timeline_status",
  );

  const tagRows = await db.execute<{ tag: string; count: string }>(sql`
    SELECT tag, COUNT(*) AS count
    FROM projects, unnest(tags) AS tag
    GROUP BY tag
    ORDER BY count DESC
  `);
  const tags: Distribution = {};
  for (const r of tagRows) tags[r.tag] = Number(r.count);
  const taggedCount = Number(
    (
      await db.execute<{ n: string }>(
        sql`SELECT COUNT(*) AS n FROM projects WHERE tags IS NOT NULL AND array_length(tags, 1) > 0`,
      )
    )[0]!.n,
  );
  tags["(no tags)"] = total - taggedCount;

  const tagsPerProjectRows = await db.execute<{ n_tags: string; count: string }>(sql`
    SELECT
      CASE
        WHEN tags IS NULL OR array_length(tags, 1) = 0 THEN '0'
        ELSE array_length(tags, 1)::text
      END AS n_tags,
      COUNT(*) AS count
    FROM projects
    GROUP BY CASE
        WHEN tags IS NULL OR array_length(tags, 1) = 0 THEN '0'
        ELSE array_length(tags, 1)::text
      END
    ORDER BY MIN(COALESCE(array_length(tags, 1), 0))
  `);
  const tagsPerProject: Distribution = {};
  for (const r of tagsPerProjectRows) tagsPerProject[r.n_tags] = Number(r.count);

  const countries = await queryDistribution(
    sql`
      SELECT COALESCE(country_code, '(null)') AS country_code, COUNT(*) AS count
      FROM projects
      GROUP BY country_code
      ORDER BY count DESC
      LIMIT 20
    `,
    "country_code",
  );

  const importSources = await queryDistribution(
    sql`
      SELECT COALESCE(s.slug, '(user-submitted)') AS source, COUNT(*) AS count
      FROM projects p
      LEFT JOIN import_sources s ON s.id = p.import_source_id
      GROUP BY s.slug
      ORDER BY count DESC
    `,
    "source",
  );

  const compRaw = await db.execute<Record<string, string>>(sql`
    SELECT
      COUNT(*) FILTER (WHERE name IS NOT NULL AND name <> '') AS has_name,
      COUNT(*) FILTER (WHERE geometry IS NOT NULL)            AS has_geometry,
      COUNT(*) FILTER (WHERE lat IS NOT NULL)                 AS has_lat,
      COUNT(*) FILTER (WHERE source_url IS NOT NULL)          AS has_source_url
    FROM projects
  `);
  const comp = compRaw[0]!;
  const completeness: Record<string, number> = {
    name: Number(comp["has_name"]),
    geometry: Number(comp["has_geometry"]),
    "lat/lng": Number(comp["has_lat"]),
    source_url: Number(comp["has_source_url"]),
  };

  const osmIdTypes = await queryDistribution(
    sql`
      SELECT
        CASE
          WHEN external_id IS NULL              THEN '(user-submitted)'
          WHEN external_id LIKE 'relation/%'    THEN 'relation'
          WHEN external_id LIKE 'way/%'         THEN 'way'
          ELSE 'other'
        END AS id_type,
        COUNT(*) AS count
      FROM projects
      GROUP BY id_type
      ORDER BY count DESC
    `,
    "id_type",
  );

  const sizeRows = await db.execute<{ bucket: string; count: string }>(sql`
    SELECT
      CASE
        WHEN geometry_size_m IS NULL      THEN '(no geometry)'
        WHEN geometry_size_m < 500        THEN '< 500m'
        WHEN geometry_size_m < 2000       THEN '500m-2km'
        WHEN geometry_size_m < 10000      THEN '2km-10km'
        WHEN geometry_size_m < 50000      THEN '10km-50km'
        WHEN geometry_size_m < 200000     THEN '50km-200km'
        ELSE                                   '> 200km'
      END AS bucket,
      COUNT(*) AS count
    FROM projects
    GROUP BY bucket
    ORDER BY MIN(COALESCE(geometry_size_m, -1))
  `);
  const geometrySize: Distribution = {};
  for (const r of sizeRows) geometrySize[r.bucket] = Number(r.count);

  return {
    timestamp: new Date().toISOString(),
    total,
    osm: Number(t.osm),
    userSubmitted: Number(t.user_submitted),
    detached: Number(t.detached),
    projectShape,
    approvalStatus,
    timelineStatus,
    tags,
    tagsPerProject,
    countries,
    importSources,
    completeness,
    geometrySize,
    osmIdTypes,
  };
}

function printDistribution(title: string, dist: Distribution, total: number) {
  console.log(`\n--- ${title} ---`);
  const entries = Object.entries(dist);
  if (entries.length === 0) {
    console.log("  (empty)");
    return;
  }
  const maxLen = Math.max(...entries.map(([k]) => k.length), 5);
  for (const [label, count] of entries) {
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
    const bar = "#".repeat(Math.round((count / total) * 40));
    console.log(
      `  ${label.padEnd(maxLen)}  ${String(count).padStart(7)}  (${pct.padStart(5)}%)  ${bar}`,
    );
  }
}

function printSnapshot(s: Snapshot) {
  console.log("=".repeat(60));
  console.log("  projects table snapshot, " + s.timestamp);
  console.log("=".repeat(60));

  console.log(`\nTOTAL ROWS: ${s.total}`);
  console.log(`  Imported (OSM):   ${s.osm}`);
  console.log(`  User-submitted:   ${s.userSubmitted}`);
  console.log(`  Soft-detached:    ${s.detached}`);

  printDistribution("Project shape (linear vs areal)", s.projectShape, s.total);
  printDistribution("Approval status", s.approvalStatus, s.total);
  printDistribution("Timeline status", s.timelineStatus, s.total);
  printDistribution("Tags (unnested)", s.tags, s.total);
  printDistribution("Tags per project", s.tagsPerProject, s.total);
  printDistribution("Country distribution (top 20)", s.countries, s.total);
  printDistribution("Import source", s.importSources, s.total);
  printDistribution("OSM id type (relation vs way)", s.osmIdTypes, s.total);

  console.log("\n--- Field completeness ---");
  const maxLen = Math.max(...Object.keys(s.completeness).map((k) => k.length));
  for (const [label, count] of Object.entries(s.completeness)) {
    const pct = s.total > 0 ? ((count / s.total) * 100).toFixed(1) : "0.0";
    console.log(
      `  ${label.padEnd(maxLen)}  ${String(count).padStart(7)} / ${s.total}  (${pct.padStart(5)}%)`,
    );
  }

  printDistribution("Geometry size", s.geometrySize, s.total);

  console.log("\n" + "=".repeat(60));
}

function diffNumber(label: string, before: number, after: number) {
  before = before ?? 0;
  after = after ?? 0;
  const delta = after - before;
  if (delta === 0) return;
  const sign = delta > 0 ? "+" : "";
  console.log(`  ${label}: ${before} -> ${after}  (${sign}${delta})`);
}

function diffDistribution(title: string, before: Distribution, after: Distribution) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const lines: string[] = [];
  for (const key of keys) {
    const b = before[key] ?? 0;
    const a = after[key] ?? 0;
    const delta = a - b;
    if (delta === 0) continue;
    const sign = delta > 0 ? "+" : "";
    const marker = delta > 0 ? "  +" : "  -";
    lines.push(`${marker} ${key}: ${b} -> ${a}  (${sign}${delta})`);
  }
  if (lines.length === 0) return;
  console.log(`\n--- ${title} ---`);
  for (const l of lines) console.log(l);
}

function printDiff(before: Snapshot, after: Snapshot) {
  console.log("=".repeat(60));
  console.log("  projects table diff");
  console.log(`  before: ${before.timestamp}`);
  console.log(`  after:  ${after.timestamp}`);
  console.log("=".repeat(60));

  console.log("\n--- Totals ---");
  diffNumber("total", before.total, after.total);
  diffNumber("osm", before.osm, after.osm);
  diffNumber("userSubmitted", before.userSubmitted, after.userSubmitted);
  diffNumber("detached", before.detached, after.detached);

  diffDistribution("Project shape (linear vs areal)", before.projectShape, after.projectShape);

  diffDistribution("Approval status", before.approvalStatus, after.approvalStatus);
  diffDistribution("Timeline status", before.timelineStatus, after.timelineStatus);
  diffDistribution("Tags (unnested)", before.tags, after.tags);
  diffDistribution("Tags per project", before.tagsPerProject, after.tagsPerProject);
  diffDistribution("Country distribution", before.countries, after.countries);
  diffDistribution("Import source", before.importSources, after.importSources);
  diffDistribution("OSM id type (relation vs way)", before.osmIdTypes, after.osmIdTypes);

  const compKeys = new Set([
    ...Object.keys(before.completeness),
    ...Object.keys(after.completeness),
  ]);
  const compLines: string[] = [];
  for (const key of compKeys) {
    const b = before.completeness[key] ?? 0;
    const a = after.completeness[key] ?? 0;
    const delta = a - b;
    if (delta === 0) continue;
    const sign = delta > 0 ? "+" : "";
    compLines.push(`  ${key}: ${b} -> ${a}  (${sign}${delta})`);
  }
  if (compLines.length > 0) {
    console.log("\n--- Field completeness ---");
    for (const l of compLines) console.log(l);
  }

  diffDistribution("Geometry size", before.geometrySize, after.geometrySize);

  console.log("\n" + "=".repeat(60));
}

async function main() {
  const mode = process.argv[2] ?? "print";

  if (mode === "save") {
    console.log("Collecting snapshot...");
    const snapshot = await collectSnapshot();
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
    console.log(`Snapshot saved to ${SNAPSHOT_PATH}`);
    console.log(`  total: ${snapshot.total} rows  (timestamp: ${snapshot.timestamp})`);
    return;
  }

  if (mode === "diff") {
    if (!fs.existsSync(SNAPSHOT_PATH)) {
      console.error(`No snapshot found at ${SNAPSHOT_PATH}. Run with "save" first.`);
      process.exit(1);
    }
    const before = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
    console.log("Collecting current state...");
    const after = await collectSnapshot();
    printDiff(before, after);
    return;
  }

  // default: print
  const snapshot = await collectSnapshot();
  printSnapshot(snapshot);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
