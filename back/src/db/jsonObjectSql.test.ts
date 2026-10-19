import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL as SqlClient } from "bun";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { jsonObjectSql } from "./jsonObject";

// Explicit opt-in. All fixtures are SELECT expressions; the connection also enforces read-only.
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("JSON object normalization in PostgreSQL", () => {
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

  const properties = {
    wikidata: "Q3240151",
    image: "https://example.com/project.jpg",
    osm_ids: ["way/541784211"],
    nested: { colour: "#a50034" },
  };

  test.each([
    { label: "object", value: properties, expected: properties },
    { label: "string-wrapped object", value: JSON.stringify(properties), expected: properties },
    { label: "empty object", value: {}, expected: {} },
    { label: "SQL null", value: undefined, expected: null },
    ...[null, "not JSON", "[]", "null", "42", '"text"', [], 42, "1e1000000"].map((value) => ({
      label: JSON.stringify(value),
      value,
      expected: null,
    })),
  ])("normalizes $label", async ({ value, expected }) => {
    if (!db) throw new Error("Database not initialized");
    // Force the parameter through text before jsonb so fixture construction itself does not
    // depend on Bun's JSON parameter encoding, the bug these queries must tolerate.
    const input =
      value === undefined ? sql`NULL::jsonb` : sql`${JSON.stringify(value)}::text::jsonb`;
    const rows = await db
      .select({ properties: jsonObjectSql(sql`input.value`) })
      .from(sql`(VALUES (${input})) AS input(value)`);
    expect(rows[0]?.properties).toEqual(expected);
  });

  test.each([
    { label: "object", value: properties },
    { label: "string-wrapped object", value: JSON.stringify(properties) },
  ])("supports indexing keys and OSM ID matching for $label", async ({ value }) => {
    if (!db) throw new Error("Database not initialized");
    const normalized = jsonObjectSql(sql`input.value`);
    const rows = await db
      .select({
        wikidata: sql<boolean>`jsonb_exists(${normalized}, 'wikidata')`,
        image: sql<boolean>`jsonb_exists(${normalized}, 'image')`,
        sharedId: sql<string>`(
          SELECT id FROM jsonb_array_elements_text((${normalized})->'osm_ids') AS ids(id)
        )`,
      })
      .from(sql`(VALUES (${JSON.stringify(value)}::text::jsonb)) AS input(value)`);
    expect(rows[0]).toEqual({ wikidata: true, image: true, sharedId: "way/541784211" });
  });
});
