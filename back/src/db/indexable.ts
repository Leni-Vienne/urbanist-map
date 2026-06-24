import { sql } from "drizzle-orm";
import { db } from "../database";

// Minimal shape both the app's shared drizzle client and the import script's postgres-js drizzle
// client satisfy, so this module can run against either connection.
type SqlExecutor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

// The curation rule that decides whether a project is worth indexing in Google. A project qualifies
// when it is approved, named, and carries visual content the SEO page can actually show: an approved
// overlay (a georeferenced 'map' overlay or a 'render' artist's impression), or an external
// wikidata/image tag the page can resolve a preview from. Detached projects pass on the strength of
// their retained user overlays; the thin redrawn OSM twin only competes if it independently carries
// its own wikidata/image tag (a name-only twin is excluded here).
//
// The fragment is reused verbatim by the bulk and per-project refresh so they can never drift.
function indexableExpr(): ReturnType<typeof sql> {
  return sql`(
    projects.name IS NOT NULL
    AND projects.status = 'approved'
    AND (
      EXISTS (
        SELECT 1 FROM overlays o
        WHERE o.project_id = projects.id AND o.status = 'approved'
      )
      OR jsonb_exists(projects.external_properties, 'wikidata')
      OR jsonb_exists(projects.external_properties, 'image')
    )
  )`;
}

// Recompute indexable for every project in one pass. Cheap to run after the daily OSM import (the
// only moment the whole table churns). Best-effort: never throws, so it can't fail the import.
export async function refreshAllIndexable(executor: SqlExecutor = db): Promise<void> {
  try {
    await executor.execute(sql`
      UPDATE projects
      SET indexable = ${indexableExpr()}
      WHERE indexable IS DISTINCT FROM ${indexableExpr()}
    `);
  } catch (error) {
    console.error("Failed to refresh indexable flags (non-fatal):", error);
  }
}

// Recompute indexable for a single project. Called on moderation approval (project or overlay) so a
// freshly-approved page becomes (de-)indexable immediately rather than waiting for the daily pass.
export async function refreshProjectIndexable(projectId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE projects
      SET indexable = ${indexableExpr()}
      WHERE projects.id = ${projectId}::uuid
        AND indexable IS DISTINCT FROM ${indexableExpr()}
    `);
  } catch (error) {
    console.error(`Failed to refresh indexable for project ${projectId} (non-fatal):`, error);
  }
}
