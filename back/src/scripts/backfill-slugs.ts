/**
 * One-time backfill of projects.slug for rows created before slug generation existed.
 * Idempotent: only touches rows where slug IS NULL, so re-running is safe (and resumes after an
 * interrupted run, since already-filled rows drop out of the WHERE).
 *
 * Slugs are deterministic from the natural key (external id, else row uuid), so the value computed
 * here matches what the OSM import / user-create path would have produced. Each slug ends in a
 * per-row-unique suffix (external id or uuid-derived), so cross-row collisions can't occur by
 * construction; the unique constraint on projects.slug is the backstop for the rare uuid-prefix clash.
 *
 * Usage: bun run back/src/scripts/backfill-slugs.ts
 *
 * Maintainer-run (writes the whole projects table). Not part of the request path, so it uses its own
 * single connection with statement_timeout disabled rather than the shared, 15s-capped pool.
 */

import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import { sql, isNull } from "drizzle-orm";
import { config } from "../config";
import { projects } from "../db/schema";
import { buildProjectSlug } from "@shared/projectSlug";

// Small enough that the UPDATE's (VALUES ...) join keeps an index-driven nested loop over the
// projects primary key instead of flipping to a seq scan + hash join of the whole table.
const BATCH_SIZE = 1000;

function stamp(): string {
  return new Date().toISOString();
}

function makeDb() {
  const url = new URL(config.DATABASE_URL);
  // No statement_timeout cap (this is a long maintenance write), and re-plan each batch with its
  // actual values so the planner sees the small VALUES cardinality and picks PK lookups.
  url.searchParams.set("options", "-c statement_timeout=0");
  const client = new SQL(url.toString(), { max: 1, prepare: false });
  return drizzle({ client });
}

async function main(): Promise<void> {
  console.log(`[${stamp()}] Backfill started (batch size ${BATCH_SIZE}).`);
  const db = makeDb();

  let processed = 0;
  let updated = 0;
  let lastLoggedAt = 0;

  for (;;) {
    let batch: { id: string; name: string | null; externalId: string | null }[];
    try {
      batch = await db
        .select({ id: projects.id, name: projects.name, externalId: projects.externalId })
        .from(projects)
        .where(isNull(projects.slug))
        .limit(BATCH_SIZE);
    } catch (error) {
      console.error(`[${stamp()}] Failed to read a batch of slug-less projects:`, error);
      process.exit(1);
    }

    if (batch.length === 0) break;

    const rows = batch.map((row) => ({
      id: row.id,
      slug: buildProjectSlug({ name: row.name, externalId: row.externalId, id: row.id }),
    }));

    // One set-based UPDATE per batch: join the computed (id, slug) pairs back onto the table.
    const values = sql.join(
      rows.map((r) => sql`(${r.id}::uuid, ${r.slug})`),
      sql`, `,
    );
    try {
      await db.execute(sql`
        UPDATE ${projects} AS p
        SET slug = v.slug
        FROM (VALUES ${values}) AS v(id, slug)
        WHERE p.id = v.id
      `);
      updated += rows.length;
    } catch (error) {
      console.error(`[${stamp()}] Failed to write a batch of slugs:`, error);
      process.exit(1);
    }

    processed += batch.length;

    // Throttle progress to roughly one line per 50k rows so the terminal stays readable.
    if (processed - lastLoggedAt >= 50_000) {
      console.log(`[${stamp()}] Processed ${processed} rows (${updated} updated)...`);
      lastLoggedAt = processed;
    }
  }

  console.log(`[${stamp()}] Backfill complete. Updated ${updated} of ${processed} processed rows.`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(`[${stamp()}]`, error);
  process.exit(1);
});
