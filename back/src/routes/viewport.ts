import * as z from "zod";
import { publicProcedure, router, TRPCError } from "../trpc";
import { projects, cities, overlays } from "../db/schema";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../database";
import {
  getUserOverlayChangeRequestIds,
  buildProjectVisibilityCondition,
  buildOverlayVisibilityCondition,
  fetchOverlayChangeRequests,
  transformOverlayDataWithChangeRequests,
  fetchOverlaysWithLocation,
  PROJECT_COLUMNS,
} from "../db/helpers";

// ── Viewport-specific visibility overrides ──────────────────────────────────
//
// In edit mode the approved overlays are now served exclusively via the MVT
// tile endpoint (vectorTileSync on the frontend). The bbox tRPC fetch must
// therefore return ONLY the user's pending/change-request overlays so that:
//   a) There is no duplication between tile-rendered and tRPC-rendered layers.
//   b) The cluster source only gets augmented with pending content.
//
// This is intentionally an inline override rather than a change to
// buildOverlayVisibilityCondition in helpers.ts, because other callers
// (getCityOverlaysAndProjects, moderation panel) still need the full set.

/**
 * Build the overlay visibility WHERE condition for the viewport bbox endpoint
 * in edit mode: ONLY the user's own pending overlays + overlays they have
 * change requests on. Approved overlays are intentionally excluded here —
 * they are delivered to the frontend via MVT tiles / vectorTileSync.
 */
function buildEditModeViewportOverlayCondition(
  userId: string,
  overlayChangeRequestIds: string[] | undefined,
): ReturnType<typeof sql> {
  if (overlayChangeRequestIds && overlayChangeRequestIds.length > 0) {
    const idsArray = `{${overlayChangeRequestIds.join(",")}}`;
    return sql`(
      (${overlays.authorId} = ${userId} AND ${overlays.status} = 'pending')
      OR ${overlays.id} = ANY(${idsArray}::uuid[])
    )`;
  }
  return sql`(${overlays.authorId} = ${userId} AND ${overlays.status} = 'pending')`;
}

/**
 * Build the project JOIN condition for the overlay viewport query in edit mode.
 * We need to join projects that are either approved (overlays on approved projects)
 * or owned by the user (overlays on the user's own pending projects). This is
 * broader than the overlay condition on purpose — it covers the project JOIN
 * rather than filtering which projects appear as standalone markers.
 */
function buildEditModeViewportProjectJoinCondition(userId: string): ReturnType<typeof sql> {
  return sql`(${projects.status} = 'approved' OR ${projects.ownerId} = ${userId})`;
}

const bboxSchema = z.object({
  minLng: z.number().min(-180).max(180),
  minLat: z.number().min(-90).max(90),
  maxLng: z.number().min(-180).max(180),
  maxLat: z.number().min(-90).max(90),
});

const getOverlaysInViewportSchema = z.object({
  bbox: bboxSchema,
  mode: z.enum(["view", "edit", "moderation"]).optional().default("view"),
});

const getProjectsInViewportSchema = z.object({
  bbox: bboxSchema,
  mode: z.enum(["edit", "moderation"]),
});

export const viewportRouter = router({
  // Global fetch for all pending items to allow map clustering from afar
  getGlobalPendingPoints: publicProcedure
    .input(z.object({ mode: z.enum(["edit", "moderation"]) }))
    .query(async ({ input, ctx }) => {
      try {
        const { mode } = input;

        if (!ctx.user) {
          return [];
        }

        // 1. Pending Projects
        const projectConditions =
          mode === "edit"
            ? sql`(${projects.ownerId} = ${ctx.user.id} AND ${projects.status} != 'approved')`
            : buildProjectVisibilityCondition(ctx.user, mode, false);

        const pendingProjects = await db
          .select({
            id: projects.id,
            lat: projects.lat,
            lng: projects.lng,
            tags: projects.tags,
            name: projects.name,
            status: projects.status,
          })
          .from(projects)
          .where(
            and(
              projectConditions,
              sql`${projects.lat} IS NOT NULL`,
              sql`${projects.lng} IS NOT NULL`,
            ),
          );

        // 2. Projects with pending overlays
        const overlayConditions =
          mode === "edit"
            ? sql`(${overlays.authorId} = ${ctx.user.id} AND ${overlays.status} != 'approved')`
            : buildOverlayVisibilityCondition(ctx.user, mode, undefined); // No overlayChangeRequestIds here, keep it simple for afar

        const pendingOverlays = await db
          .selectDistinct({
            id: projects.id,
            lat: projects.lat,
            lng: projects.lng,
            tags: projects.tags,
            name: projects.name,
            status: sql<string>`'pending'`,
          })
          .from(overlays)
          .innerJoin(projects, eq(overlays.projectId, projects.id))
          .where(
            and(
              overlayConditions,
              sql`${projects.lat} IS NOT NULL`,
              sql`${projects.lng} IS NOT NULL`,
            ),
          );

        // Merge results and deduplicate
        const merged = new Map();
        for (const p of pendingProjects) merged.set(p.id, p);
        for (const p of pendingOverlays) merged.set(p.id, p);

        return [...merged.values()];
      } catch (error) {
        console.error("Error fetching global pending points:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch global pending points",
        });
      }
    }),

  // Bbox-based overlay fetch for edit and moderation modes.
  // Replaces getCityOverlaysAndProjects as the map rendering data source.
  // Uses ST_Intersects on overlay centroid against the viewport bbox.
  // Cache-Control: no-store (user-specific, session-gated).
  getOverlaysInViewport: publicProcedure
    .input(getOverlaysInViewportSchema)
    .query(async ({ input, ctx }) => {
      try {
        const { bbox, mode } = input;

        // SECURITY: Reject moderation mode for unauthenticated users
        if (mode === "moderation" && !ctx.user) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Authentication required for moderation mode",
          });
        }

        // Fetch user's overlay change request IDs if in edit mode
        const overlayChangeRequestIds =
          ctx.user && mode === "edit"
            ? await getUserOverlayChangeRequestIds(db, ctx.user.id)
            : undefined;

        // Bbox condition on overlay centroid using ST_Intersects.
        // ST_SetSRID forces SRID 4326 on the stored geometry (data may have SRID 0 at rest).
        const bboxCondition = sql`ST_Intersects(
          ST_SetSRID(${overlays.centroid}, 4326),
          ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)
        )`;

        const whereConditions = [
          bboxCondition,
          // In edit mode: only return user's pending overlays (approved overlays come via
          // MVT tiles / vectorTileSync). In other modes: use the shared helper.
          mode === "edit" && ctx.user
            ? buildEditModeViewportOverlayCondition(ctx.user.id, overlayChangeRequestIds)
            : buildOverlayVisibilityCondition(ctx.user, mode, overlayChangeRequestIds),
          // Project JOIN condition: in edit mode, allow overlays on approved OR user-owned projects.
          mode === "edit" && ctx.user
            ? buildEditModeViewportProjectJoinCondition(ctx.user.id)
            : buildProjectVisibilityCondition(ctx.user, mode, false),
        ];

        const overlaysData = await fetchOverlaysWithLocation(whereConditions);

        // Fetch and group change requests by overlay ID
        const changeRequestsByOverlay = await fetchOverlayChangeRequests(ctx.user, mode);

        // In moderation mode, count change requests per overlay
        const allChangeRequestCounts = new Map<string, number>();
        if (mode === "moderation") {
          for (const [overlayId, requests] of changeRequestsByOverlay) {
            allChangeRequestCounts.set(overlayId, requests.length);
          }
        }

        const result = transformOverlayDataWithChangeRequests(
          overlaysData,
          changeRequestsByOverlay,
          allChangeRequestCounts,
          mode,
          ctx.user?.id,
        );

        return result;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error("Error fetching overlays in viewport:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch overlays in viewport",
        });
      }
    }),

  // Bbox-based standalone project fetch for edit and moderation modes.
  // Replaces getCityProjects as the map rendering data source for standalone markers.
  // Uses ST_Intersects on project center_coordinate against the viewport bbox.
  getProjectsInViewport: publicProcedure
    .input(getProjectsInViewportSchema)
    .query(async ({ input, ctx }) => {
      try {
        const { bbox, mode } = input;

        if (!ctx.user) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Authentication required for edit/moderation mode",
          });
        }

        // ST_SetSRID forces SRID 4326 on the stored geometry (data may have SRID 0 at rest).
        const bboxCondition = sql`ST_Intersects(
          ST_SetSRID(${projects.centerCoordinate}, 4326),
          ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)
        )`;

        const whereConditions = [
          bboxCondition,
          // In edit mode: only return the user's own non-approved projects (pending/rejected/null).
          // Approved projects are already in the cluster source (/api/projects/points) which runs
          // in all modes. Returning approved here would cause duplicates in the cluster source merge.
          mode === "edit"
            ? sql`(${projects.ownerId} = ${ctx.user.id} AND ${projects.status} != 'approved')`
            : buildProjectVisibilityCondition(ctx.user, mode, false),
        ];

        const projectsData = await db
          .select({
            ...PROJECT_COLUMNS,
            overlayCount:
              mode === "edit"
                ? sql<number>`COUNT(CASE WHEN ${overlays.status} = 'approved' OR ${overlays.authorId} = ${ctx.user.id} THEN 1 END)::int`
                : sql<number>`COUNT(CASE WHEN ${overlays.status} = 'approved' OR ${overlays.status} = 'pending' THEN 1 END)::int`,
            city: cities,
          })
          .from(projects)
          .innerJoin(cities, eq(cities.id, projects.cityId))
          .leftJoin(overlays, eq(overlays.projectId, projects.id))
          .where(and(...whereConditions))
          // GROUP BY primary keys only — PostgreSQL's functional dependency optimization
          // covers all other columns of both tables (projects.id and cities.id are PKs).
          // Avoids B-tree equality requirement on projects.geometry (PostGIS type).
          .groupBy(projects.id, cities.id);

        return projectsData;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error("Error fetching projects in viewport:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch projects in viewport",
        });
      }
    }),
});
