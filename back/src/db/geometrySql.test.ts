import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL as SqlClient } from "bun";
import { sql, type SQLWrapper } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { overlayCornersJsonSql, overlayGeometryValues, projectGeometryValues } from "./geometry";
import { captureProjectMapState } from "./projectMapState";

// Explicit opt-in. Fixtures are SELECT expressions; no application tables are read or written.
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("geometry and map bounds in PostGIS", () => {
  let client: SqlClient | null = null;
  let database: ReturnType<typeof drizzle> | null = null;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
    const url = new URL(databaseUrl);
    url.searchParams.set(
      "options",
      "-c default_transaction_read_only=on -c statement_timeout=10000",
    );
    client = new SqlClient(url.toString(), { max: 1 });
    database = drizzle({ client });
  });

  afterAll(async () => {
    await client?.close();
  });

  test("round-trips four ordered corners and their updated center", async () => {
    if (!database) throw new Error("Database not initialized");
    const corners = [
      { lat: 40, lng: 2 },
      { lat: 40, lng: 4 },
      { lat: 42, lng: 4 },
      { lat: 42, lng: 2 },
    ];
    const values = overlayGeometryValues(corners);
    const rows = await database
      .select({
        corners: overlayCornersJsonSql(sql`footprint.corners`),
        lat: sql<number>`ST_Y(footprint.centroid)`,
        lng: sql<number>`ST_X(footprint.centroid)`,
      })
      .from(sql`(SELECT ${values.corners} AS corners, ${values.centroid} AS centroid) footprint`);
    expect(rows[0]).toEqual({ corners, lat: 41, lng: 3 });
  });

  test("stores valid project geometry and derives its ground extent", async () => {
    if (!database) throw new Error("Database not initialized");
    const values = projectGeometryValues({
      type: "GeometryCollection",
      geometries: [
        {
          type: "LineString",
          coordinates: [
            [0, 0],
            [0.001, 0],
          ],
        },
      ],
    });
    if (values.geometry === null) throw new Error("Missing geometry");
    const rows = await database
      .select({
        valid: sql<boolean>`ST_IsValid(${values.geometry})`,
        size: sql<number>`${values.geometrySizeM}`,
      })
      .from(sql`(VALUES (1)) AS fixture(value)`);
    expect(rows[0]?.valid).toBe(true);
    expect(rows[0]?.size).toBeGreaterThan(110);
    expect(rows[0]?.size).toBeLessThan(112);
  });

  test("captures shape, marker and distant approved footprint separately", async () => {
    if (!database) throw new Error("Database not initialized");
    const testDatabase = database;
    const id = "11111111-1111-4111-8111-111111111111";
    const footprint = overlayGeometryValues([
      { lat: 40, lng: 20 },
      { lat: 40, lng: 21 },
      { lat: 41, lng: 21 },
      { lat: 41, lng: 20 },
    ]);
    const state = await captureProjectMapState(
      {
        execute<Row extends Record<string, unknown>>(query: SQLWrapper | string) {
          if (typeof query === "string") throw new Error("Expected a SQL expression");
          // Outer CTEs shadow the application tables inside the captured query.
          return testDatabase.execute<Row>(sql`
          WITH projects AS (
            SELECT ${id}::uuid AS id,
              ST_SetSRID(ST_MakeLine(ST_MakePoint(2, 40), ST_MakePoint(3, 41)), 4326) AS geometry,
              ST_SetSRID(ST_MakePoint(4, 42), 4326) AS center_coordinate,
              'approved' AS status
          ), overlays AS (
            SELECT ${id}::uuid AS project_id, ${footprint.corners} AS corners,
              'approved' AS status, 'map' AS kind
            UNION ALL
            SELECT ${id}::uuid, ST_SetSRID(ST_MakePoint(99, 80), 4326), 'pending', 'map'
          )
          SELECT * FROM (${query.getSQL()}) captured
        `);
        },
      },
      [id, id],
    );
    expect(state.projectIds).toEqual([id]);
    expect(state.bounds).toHaveLength(3);
    expect(state.bounds).toContainEqual({ minLng: 2, minLat: 40, maxLng: 3, maxLat: 41 });
    expect(state.bounds).toContainEqual({ minLng: 4, minLat: 42, maxLng: 4, maxLat: 42 });
    expect(state.bounds).toContainEqual({ minLng: 20, minLat: 40, maxLng: 21, maxLat: 41 });
  });
});
