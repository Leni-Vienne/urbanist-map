import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL as SqlClient } from "bun";
import { desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import type { BoundaryPathEntry } from "@shared/types/boundary";

// Read-only, opt-in fixtures shadow all application tables. No application data is accessed.
const databaseUrl = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL ??= "postgres://test:test@localhost:1/test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.COOKIE_SECRET ??= "feed-sql-test-secret-32-characters";
const { buildFeedQuery } = await import("./feed");
type FeedInput = Parameters<typeof buildFeedQuery>[0];
type Row = {
  projectId: string;
  date: string;
  imageId: string | null;
  boundaryPath: BoundaryPathEntry[];
};
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const fixtures = sql`
  WITH projects AS (
    SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid AS id,
      CASE source WHEN 'rejected' THEN 'rejected' WHEN 'pending' THEN 'pending' ELSE 'approved' END AS status,
      'project ' || n AS name,
      '2026-01-01'::timestamptz + micros * interval '1 microsecond' AS updated_at,
      CASE WHEN source = 'locked' THEN '2025-01-01'::timestamptz
        ELSE '2026-01-01'::timestamptz + micros * interval '1 microsecond' END AS external_last_modified,
      CASE WHEN source = 'locked' THEN '2026-01-01'::timestamptz END AS import_locked_at,
      CASE WHEN source IN ('imported', 'locked') THEN 1 END AS import_source_id,
      CASE WHEN n IN (1, 3, 6) THEN ARRAY['rail'] ELSE ARRAY['road'] END AS tags,
      'planned'::text AS timeline_status, 100::float8 AS geometry_size_m,
      CASE WHEN n = 3 THEN 8 END::bigint AS admin_boundary_id, 'FRA'::text AS country_code,
      48::float8 AS lat, 2::float8 AS lng, NULL::geometry AS geometry,
      ST_SetSRID(ST_MakePoint(2, 48), 4326) AS center_coordinate
    FROM (VALUES (1, 'direct', 900), (2, 'imported', 900), (3, 'image', 0),
      (4, 'image', 0), (5, 'imported', 700), (6, 'locked', 600),
      (7, 'rejected', 999), (8, 'pending', 999), (9, 'direct', 500)) p(n, source, micros)
  ), overlays AS (
    SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid AS id,
      ('00000000-0000-4000-8000-' || lpad(project::text, 12, '0'))::uuid AS project_id,
      '2026-01-01'::timestamptz + micros * interval '1 microsecond' AS updated_at,
      status, CASE WHEN project = 3 THEN 'render' ELSE 'map' END AS kind,
      n || '.png' AS filename, NULL::text AS caption,
      ST_MakeEnvelope(2, 48, 2.01, 48.01, 4326) AS corners
    FROM (VALUES (10, 4, 800, 'approved'), (11, 4, 800, 'approved'),
      (12, 3, 900, 'approved'), (13, 3, 100, 'approved'),
      (14, 8, 999, 'approved'), (15, 9, 999, 'pending')) o(n, project, micros, status)
  ), admin_boundaries AS (
    SELECT * FROM (VALUES
      (8::bigint, 4::bigint, 8, 'Local city', 'English city', '{"fr":"French city","de":"German city"}'::jsonb),
      (4, 2, 4, 'Local state', NULL, NULL),
      (2, NULL, 2, 'Local country', 'English country', NULL)
    ) b(osm_id, parent_id, admin_level, name, name_en, names)
  )
`;

describe.skipIf(!databaseUrl)("feed pagination in PostgreSQL", () => {
  let client: SqlClient;
  let database: ReturnType<typeof drizzle>;

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

  async function page(input: FeedInput): Promise<Row[]> {
    const feed = buildFeedQuery(input).as("feed");
    return await database.execute<Row>(sql`${fixtures}
      SELECT ${feed.projectId} AS "projectId", ${feed.cursorDate} AS date,
        ${feed.image.id} AS "imageId", ${feed.boundaryPath} AS "boundaryPath"
      FROM ${feed} ORDER BY ${desc(feed.updatedAt)}, ${desc(feed.projectId)}
    `);
  }

  async function collect(options: Partial<FeedInput> = {}): Promise<Row[]> {
    const input: FeedInput = { source: "all", tags: [], statuses: [], limit: 2, ...options };
    const collected: Row[] = [];
    // Bound the loop so a broken cursor fails rather than hanging the test.
    for (let i = 0; i < 12; i += 1) {
      const rows = await page(input);
      const items = rows.slice(0, input.limit);
      collected.push(...items);
      const last = items.at(-1);
      if (rows.length <= input.limit || !last) return collected;
      input.cursor = { date: last.date, projectId: last.projectId };
    }
    throw new Error("Feed cursor did not reach the end");
  }

  test.each([1, 2, 3, 20])(
    "keeps mixed-source ties and microseconds across pages of %i",
    async (limit) => {
      const rows = await collect({ limit });
      expect(rows.map((row) => row.projectId)).toEqual([3, 2, 1, 4, 5, 6, 9].map(id));
      expect(rows[0]?.date).toBe("2026-01-01T00:00:00.000900Z");
      expect(rows.filter((row) => row.imageId).map((row) => row.imageId)).toEqual([id(12), id(11)]);
    },
  );

  test("hydrates the boundary chain with the feed's localized names", async () => {
    const [withPath, withoutPath] = await collect({ limit: 20 });
    expect(withPath?.boundaryPath).toEqual([
      { adminLevel: 8, name: "Local city", nameEn: "English city", names: { fr: "French city" } },
      { adminLevel: 4, name: "Local state", nameEn: null, names: null },
      { adminLevel: 2, name: "Local country", nameEn: "English country", names: null },
    ]);
    expect(withoutPath?.boundaryPath).toEqual([]);
  });

  test.each([
    ["community", [3, 1, 4, 6, 9]],
    ["osm", [2, 5]],
  ] as const)(
    "limits %s to its projects, including locked imports as community",
    async (source, expected) => {
      expect((await collect({ source })).map((row) => row.projectId)).toEqual(expected.map(id));
    },
  );

  test("applies image, tag and area filters before pagination", async () => {
    expect((await collect({ onlyWithImages: true })).map((row) => row.projectId)).toEqual([
      id(3),
      id(4),
    ]);
    expect((await collect({ tags: ["rail"], limit: 1 })).map((row) => row.projectId)).toEqual(
      [3, 1, 6].map(id),
    );
    expect(await collect({ mapArea: { west: 10, south: 40, east: 11, north: 41 } })).toEqual([]);
    expect(
      (await collect({ mapArea: { west: 1, south: 47, east: 3, north: 49 } })).map(
        (row) => row.projectId,
      ),
    ).toEqual([3, 2, 1, 4, 5, 6, 9].map(id));
  });
});
