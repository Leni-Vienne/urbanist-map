import { sql } from "drizzle-orm";
import { db } from "../database";
import { jsonObjectSql } from "./jsonObject";

// Minimal shape both the app's shared and import script's Drizzle clients satisfy.
type SqlExecutor = Pick<typeof db, "execute">;

function indexableExpr(): ReturnType<typeof sql> {
  const properties = jsonObjectSql(sql`projects.external_properties`);
  return sql`COALESCE((
    NULLIF(BTRIM(projects.name), '') IS NOT NULL
    AND projects.status = 'approved'
    AND (
      EXISTS (
        SELECT 1 FROM overlays o
        WHERE o.project_id = projects.id AND o.status = 'approved'
      )
      OR NULLIF(BTRIM(${properties}->>'wikidata'), '') IS NOT NULL
      OR NULLIF(BTRIM(${properties}->>'image'), '') IS NOT NULL
    )
  ), false)`;
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

// Recompute indexable after app mutations (approval, edits, re-linking, deletion of images), so a
// page becomes (de-)indexable immediately rather than waiting for the daily import pass.
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
