import { afterAll, describe, expect, test } from "bun:test";
import { SQL as SqlClient } from "bun";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { projects } from "../../db/schema";

// Opt-in read-only fixture: CTEs shadow the three application tables used by the query.
const databaseUrl = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL ??= "postgres://test:test@localhost:1/test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.COOKIE_SECRET ??= "queue-sql-test-secret-at-least-32-characters";
const { buildPendingModerationQuery } = await import("./queue");

describe.skipIf(!databaseUrl)("moderation eligibility in PostgreSQL", () => {
  let client: SqlClient | undefined;
  afterAll(async () => {
    await client?.close();
  });

  test("counts the same actionable entities that determine queue membership", async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
    const url = new URL(databaseUrl);
    url.searchParams.set(
      "options",
      "-c default_transaction_read_only=on -c statement_timeout=10000",
    );
    client = new SqlClient(url.toString(), { max: 1 });
    const database = drizzle({ client });
    const pending = buildPendingModerationQuery(
      eq(projects.countryCode, "FRA"),
      new Set(["hidden"]),
    ).as("pending");
    const rows = await database.execute<{ id: number; count: number }>(sql`
      WITH projects AS (
        SELECT n AS id, CASE WHEN n IN (1, 5, 12, 13) THEN 'pending' ELSE 'approved' END AS status,
          CASE WHEN n IN (5, 6) THEN 'hidden' WHEN n = 13 THEN NULL ELSE 'visible' END AS owner_id,
          CASE WHEN n = 12 THEN 'DEU' ELSE 'FRA' END AS country_code
        FROM generate_series(1, 17) n
      ), overlays AS (
        SELECT n AS id, n AS project_id, status,
          CASE WHEN n IN (7, 9) THEN 'hidden' WHEN n = 14 THEN NULL ELSE 'visible' END AS author_id
        FROM (VALUES (2, 'pending'), (4, 'approved'), (6, 'pending'), (7, 'pending'),
          (9, 'approved'), (10, 'rejected'), (11, 'replaced'), (14, 'pending'),
          (16, 'approved'), (17, 'pending')) o(n, status)
      ), change_requests AS (
        SELECT n AS entity_id, kind AS entity_type, 'pending' AS status,
          CASE WHEN n IN (8, 16) THEN 'hidden' WHEN n = 15 THEN NULL ELSE 'visible' END AS requested_by
        FROM (VALUES (3, 'project'), (4, 'overlay'), (8, 'project'), (9, 'overlay'),
          (10, 'overlay'), (11, 'overlay'), (15, 'project'), (16, 'overlay'), (17, 'project')) c(n, kind)
      )
      SELECT ${pending.projectId} AS id, COUNT(*)::int AS count
      FROM ${pending} GROUP BY ${pending.projectId} ORDER BY ${pending.projectId}
    `);
    // Hidden owners, image authors and requesters cannot leave an empty project in the queue.
    // Rejected/replaced image requests and other countries also contribute no badge count.
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 13, 14, 15, 17]);
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(9);
    expect(rows.find((row) => row.id === 17)?.count).toBe(2);
  });
});
