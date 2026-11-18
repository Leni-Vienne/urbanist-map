import { and, eq, sql } from "drizzle-orm";
import { changeRequests, importSources, overlays, projects } from "../db/schema";
import type { DatabaseExecutor } from "../database";
import { fetchOverlaysForMap, PROJECT_COLUMNS, IMPORT_SOURCE_COLUMNS } from "../db/helpers";
import type { SessionUser } from "../lib/types";

function buildEditModeProjectJoinCondition(userId: string): ReturnType<typeof sql> {
  return sql`(${projects.status} = 'approved' OR ${projects.ownerId} = ${userId})`;
}

function mergeProjectsById<T extends { id: string }>(...projectGroups: T[][]): T[] {
  const projectsById = new Map<string, T>();
  for (const group of projectGroups) {
    for (const project of group) projectsById.set(project.id, project);
  }
  return [...projectsById.values()];
}

export async function getEditSessionData(database: DatabaseExecutor, user: SessionUser) {
  const userId = user.id;
  const overlayCondition = sql`(
    (${overlays.authorId} = ${userId} AND ${overlays.status} = 'pending')
    OR EXISTS (
      SELECT 1 FROM ${changeRequests}
      WHERE ${changeRequests.entityId} = ${overlays.id}
        AND ${changeRequests.entityType} = 'overlay'
        AND ${changeRequests.requestedBy} = ${userId}
        AND ${changeRequests.status} IN ('pending', 'conflicted')
    )
  )`;

  const overlayResult = await fetchOverlaysForMap(
    database,
    [overlayCondition, buildEditModeProjectJoinCondition(userId)],
    user,
  );
  const projectRows = await database
    .select({
      ...PROJECT_COLUMNS,
      importSource: IMPORT_SOURCE_COLUMNS,
      hasImage: sql<boolean>`EXISTS (
        SELECT 1
        FROM overlays AS project_image
        WHERE project_image.project_id = ${projects.id}
          AND (
            project_image.status = 'approved'
            OR (project_image.status = 'pending' AND project_image.author_id = ${userId})
          )
      )`,
    })
    .from(projects)
    .leftJoin(importSources, eq(importSources.id, projects.importSourceId))
    .where(and(sql`${projects.ownerId} = ${userId}`, sql`${projects.status} != 'approved'`));

  return {
    overlays: overlayResult.overlays,
    projects: mergeProjectsById(overlayResult.projects, projectRows),
  };
}
