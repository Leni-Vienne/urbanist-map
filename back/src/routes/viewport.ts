import { publicProcedure, router, TRPCError } from "../trpc";
import { projects, overlays, importSources } from "../db/schema";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../database";
import {
  getUserOverlayChangeRequestIds,
  fetchOverlaysForMap,
  PROJECT_COLUMNS,
} from "../db/helpers";

/**
 * Build the project JOIN condition for the overlay query in edit mode.
 * We need to join projects that are either approved (overlays on approved projects)
 * or owned by the user (overlays on the user's own pending projects). This is
 * broader than the overlay condition on purpose, it covers the project JOIN
 * rather than filtering which projects appear as standalone markers.
 */
function buildEditModeViewportProjectJoinCondition(userId: string): ReturnType<typeof sql> {
  return sql`(${projects.status} = 'approved' OR ${projects.ownerId} = ${userId})`;
}

function mergeProjectsById<T extends { id: string }>(...projectGroups: T[][]): T[] {
  const projectsById = new Map<string, T>();
  for (const group of projectGroups) {
    for (const project of group) projectsById.set(project.id, project);
  }
  return [...projectsById.values()];
}

export const viewportRouter = router({
  // Session-scoped map fetch for edit mode. Returns the caller's full pending set (own pending
  // overlays + own open change-request overlays + own non-approved projects) in ONE round trip,
  // bbox-free. Approved overlays come via MVT tiles / vectorTileSync. Fetched once on edit entry
  // and re-run only on explicit mutation events; panning does not refetch.
  getEditSessionData: publicProcedure.query(async ({ ctx }) => {
    try {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Authentication required for edit mode",
        });
      }

      const userId = ctx.user.id;
      const openCrIds = await getUserOverlayChangeRequestIds(db, userId);

      // Own pending overlays UNION own open change-request overlays.
      const overlayCondition =
        openCrIds.length > 0
          ? sql`((${overlays.authorId} = ${userId} AND ${overlays.status} = 'pending') OR ${overlays.id} = ANY(${`{${openCrIds.join(",")}}`}::uuid[]))`
          : sql`(${overlays.authorId} = ${userId} AND ${overlays.status} = 'pending')`;

      const overlayResult = await fetchOverlaysForMap(
        [overlayCondition, buildEditModeViewportProjectJoinCondition(userId)],
        ctx.user,
      );

      const projectsData = await db
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
        projects: mergeProjectsById(overlayResult.projects, projectsData),
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      console.error("Error fetching edit session data:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch edit session data",
      });
    }
  }),
});
