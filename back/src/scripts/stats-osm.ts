/**
 * Snapshot stats for the projects table, with before/after diff support.
 *
 * Usage:
 *   bun run back/src/scripts/stats-osm.ts         , print current stats
 *   bun run back/src/scripts/stats-osm.ts save    , save snapshot to disk
 *   bun run back/src/scripts/stats-osm.ts diff    , diff current state against saved snapshot
 */

import { db } from "../database";
import { sql } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { printDiff, printSnapshot, type Distribution, type Snapshot } from "./osmStats";
import { logOsmEvent } from "./osmLog";

const SNAPSHOT_PATH = path.join(process.cwd(), "back/src/scripts/projects-stats-snapshot.json");

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

export async function collectSnapshot(
  filter: ReturnType<typeof sql> = sql`TRUE`,
): Promise<Snapshot> {
  const source = sql`(SELECT * FROM projects WHERE ${filter})`;

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
    FROM ${source} projects
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
      FROM ${source} p
      LEFT JOIN LATERAL ST_Dump(p.geometry) AS d ON TRUE
      GROUP BY p.id, p.geometry
    ) sub
    GROUP BY shape
    ORDER BY count DESC
  `);
  const projectShape: Distribution = {};
  for (const r of shapeRaw) projectShape[r.shape] = Number(r.count);

  const approvalStatus = await queryDistribution(
    sql`SELECT status, COUNT(*) AS count FROM ${source} projects GROUP BY status ORDER BY count DESC`,
    "status",
  );

  const timelineStatus = await queryDistribution(
    sql`SELECT timeline_status, COUNT(*) AS count FROM ${source} projects GROUP BY timeline_status ORDER BY count DESC`,
    "timeline_status",
  );

  const tagRows = await db.execute<{ tag: string; count: string }>(sql`
    SELECT tag, COUNT(*) AS count
    FROM ${source} projects, unnest(tags) AS tag
    GROUP BY tag
    ORDER BY count DESC
  `);
  const tags: Distribution = {};
  for (const r of tagRows) tags[r.tag] = Number(r.count);
  const taggedCount = Number(
    (
      await db.execute<{ n: string }>(
        sql`SELECT COUNT(*) AS n FROM ${source} projects WHERE tags IS NOT NULL AND array_length(tags, 1) > 0`,
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
    FROM ${source} projects
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
      FROM ${source} projects
      GROUP BY country_code
      ORDER BY count DESC
      LIMIT 20
    `,
    "country_code",
  );

  const importSources = await queryDistribution(
    sql`
      SELECT COALESCE(s.slug, '(user-submitted)') AS source, COUNT(*) AS count
      FROM ${source} p
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
    FROM ${source} projects
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
      FROM ${source} projects
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
    FROM ${source} projects
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

async function main() {
  const mode = process.argv[2] ?? "print";

  if (mode === "save") {
    const snapshot = await collectSnapshot();
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot) + "\n");
    logOsmEvent("osm_stats", "snapshot_saved", { file: SNAPSHOT_PATH, ...snapshot });
    return;
  }

  if (mode === "diff") {
    if (!fs.existsSync(SNAPSHOT_PATH)) {
      throw new Error(`No snapshot found at ${SNAPSHOT_PATH}. Run with "save" first.`);
    }
    const before = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
    const after = await collectSnapshot();
    printDiff(before, after);
    return;
  }

  // default: print
  const snapshot = await collectSnapshot();
  printSnapshot(snapshot);
}

if (import.meta.main) {
  main().catch((err) => {
    logOsmEvent("osm_stats", "stats_failed", { error: err }, "error");
    process.exit(1);
  });
}
