import { and, eq, sql } from "drizzle-orm";
import { importSources, overlays, projects } from "../db/schema";
import type { DatabaseExecutor } from "../database";
import {
  fetchOverlaysForMap,
  getUserOverlayChangeRequestIds,
  PROJECT_COLUMNS,
} from "../db/helpers";
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
  const openChangeRequestIds = await getUserOverlayChangeRequestIds(database, userId);
  const overlayCondition =
    openChangeRequestIds.length > 0
      ? sql`((${overlays.authorId} = ${userId} AND ${overlays.status} = 'pending') OR ${overlays.id} = ANY(${`{${openChangeRequestIds.join(",")}}`}::uuid[]))`
      : sql`(${overlays.authorId} = ${userId} AND ${overlays.status} = 'pending')`;

  const overlayResult = await fetchOverlaysForMap(
    database,
    [overlayCondition, buildEditModeProjectJoinCondition(userId)],
    user,
  );
  const projectRows = await database
    .select({
      ...PROJECT_COLUMNS,
      importSource: importSources,
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
