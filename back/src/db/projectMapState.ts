import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../database";

export type TileBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export interface ProjectMapState {
  projectIds: string[];
  bounds: TileBounds[];
}

// Capture before a transaction changes/deletes rows. Include every public representation:
// a project's shape AND marker, plus approved image footprints (which can be elsewhere).
// Keep separate bounds so distant features don't invalidate the whole rectangle between them.
export async function captureProjectMapState(
  executor: Pick<DatabaseExecutor, "execute">,
  projectIds: readonly string[],
): Promise<ProjectMapState> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return { projectIds: ids, bounds: [] };
  const parameters = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const bounds = await executor.execute<TileBounds>(sql`
    WITH affected AS (
      SELECT id, geometry, center_coordinate FROM projects WHERE id IN (${parameters})
        AND status = 'approved'
    ), shapes AS (
      SELECT geometry AS geom FROM affected
      UNION ALL
      SELECT center_coordinate FROM affected
      UNION ALL
      SELECT o.corners FROM overlays o JOIN affected p ON p.id = o.project_id
      WHERE o.status = 'approved' AND o.kind = 'map'
    )
    SELECT DISTINCT ST_XMin(geom) AS "minLng", ST_YMin(geom) AS "minLat",
                    ST_XMax(geom) AS "maxLng", ST_YMax(geom) AS "maxLat"
    FROM shapes WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
  `);
  return { projectIds: ids, bounds: [...bounds] };
}
