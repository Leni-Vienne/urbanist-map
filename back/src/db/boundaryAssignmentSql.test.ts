import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL as SqlClient } from "bun";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { boundaryForGeometrySql, projectEffectiveGeometrySql } from "./boundaryAssignment";

// Opt-in, read-only fixtures. CTEs shadow application tables; safe_overlay_fraction comes from
// the database migrations, so these exercise the same coverage calculation as the importer.
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("boundary assignment in PostGIS", () => {
  let client: SqlClient | null = null;
  let db: ReturnType<typeof drizzle> | null = null;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
    const url = new URL(databaseUrl);
    url.searchParams.set(
      "options",
      "-c default_transaction_read_only=on -c statement_timeout=10000",
    );
    client = new SqlClient(url.toString(), { max: 1 });
    db = drizzle({ client });
  });

  afterAll(async () => {
    await client?.close();
  });

  async function assign(
    geometry: string | null,
    overlay: string | null = null,
    overlayStatus = "approved",
    overlayKind = "map",
    extraBoundary: string | null = null,
  ) {
    if (!db) throw new Error("Database not initialized");
    const rows = await db.execute<{ boundary_id: string | null }>(sql`
      WITH admin_boundaries AS (
        SELECT osm_id, admin_level, ST_GeomFromText(wkt, 4326) AS geom
        FROM (VALUES
          ('country', 2, 'POLYGON((0 0,30 0,30 20,0 20,0 0))'),
          ('state', 4, 'POLYGON((0 0,20 0,20 20,0 20,0 0))'),
          ('city', 8, 'POLYGON((0 0,10 0,10 10,0 10,0 0))'),
          ('west', 10, 'POLYGON((0 0,5 0,5 10,0 10,0 0))'),
          ('east', 10, 'POLYGON((5 0,10 0,10 10,5 10,5 0))'),
          ('extra', 10, ${extraBoundary})
        ) fixture(osm_id, admin_level, wkt)
        WHERE wkt IS NOT NULL
      ), projects AS (
        SELECT 'project' AS id, ST_GeomFromText(${geometry}, 4326) AS geometry,
          ST_GeomFromText('POINT(1 2)', 4326) AS center_coordinate
      ), overlays AS (
        SELECT 'project' AS project_id, ST_GeomFromText(${overlay}, 4326) AS corners,
          ${overlayStatus}::text AS status, ${overlayKind}::text AS kind
      )
      SELECT boundary.boundary_id
      FROM projects p
      JOIN LATERAL (
        SELECT ${sql.raw(projectEffectiveGeometrySql("p"))} AS geom OFFSET 0
      ) eff ON true
      LEFT JOIN LATERAL (${boundaryForGeometrySql("eff.geom")}) boundary ON true
    `);
    return rows[0]?.boundary_id;
  }

  test.each([
    ["contained point", "POINT(1 2)", "west"],
    ["contained line", "LINESTRING(1 2,4 2)", "west"],
    ["majority line", "LINESTRING(0 2,6 2)", "west"],
    ["exactly 80%", "LINESTRING(0 2,6.25 2)", "west"],
    ["below 80%", "LINESTRING(0 2,6.26 2)", "city"],
    ["split neighborhoods", "LINESTRING(0 2,8 2)", "city"],
    ["split cities", "LINESTRING(0 2,18 2)", "state"],
    ["split states", "LINESTRING(0 2,28 2)", "country"],
    ["no qualifying country", "LINESTRING(0 2,40 2)", null],
    ["outside all boundaries", "POINT(40 2)", null],
    ["empty geometry falling back to the marker", "GEOMETRYCOLLECTION EMPTY", "west"],
    ["majority polygon", "POLYGON((0 2,6 2,6 4,0 4,0 2))", "west"],
    ["split polygon", "POLYGON((0 2,8 2,8 4,0 4,0 2))", "city"],
    [
      "disconnected footprint",
      "MULTIPOLYGON(((1 2,2 2,2 4,1 4,1 2)),((7 2,8 2,8 4,7 4,7 2)))",
      "city",
    ],
  ])("assigns %s", async (_label, geometry, expected) => {
    expect(await assign(geometry)).toBe(expected);
  });

  test("chooses the highest coverage among qualifying boundaries at the same level", async () => {
    expect(
      await assign(
        "LINESTRING(0 2,6.25 2)",
        null,
        "approved",
        "map",
        "POLYGON((0 0,6 0,6 10,0 10,0 0))",
      ),
    ).toBe("extra");
  });

  test("rejects bounding-box hits whose polygon does not intersect the footprint", async () => {
    expect(
      await assign(
        "LINESTRING(2 2,4 2)",
        null,
        "approved",
        "map",
        "POLYGON((0 0,10 0,10 10,0 10,0 0),(1 1,1 9,9 9,9 1,1 1))",
      ),
    ).toBe("west");
  });

  test("falls back to the marker for a project without geometry or overlays", async () => {
    expect(await assign(null)).toBe("west");
  });

  const eastOverlay = "POLYGON((7 2,9 2,9 4,7 4,7 2))";

  test("uses approved map overlays instead of the fallback marker", async () => {
    expect(await assign(null, eastOverlay)).toBe("east");
  });

  test("includes approved overlays when measuring the project's full footprint", async () => {
    expect(await assign("POLYGON((1 2,2 2,2 4,1 4,1 2))", eastOverlay)).toBe("city");
  });

  test.each([
    ["pending", "map"],
    ["approved", "render"],
  ])("ignores %s %s overlays", async (status, kind) => {
    expect(await assign(null, eastOverlay, status, kind)).toBe("west");
  });
});
