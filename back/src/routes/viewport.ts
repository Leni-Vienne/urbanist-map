import * as z from "zod";
import { publicProcedure, router, TRPCError } from "../trpc";
import { projects, cities, overlays, changeRequests } from "../db/schema";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../database";
import type { OverlayData } from "@shared/types";
import {
  getUserOverlayChangeRequestIds,
  buildProjectVisibilityCondition,
  buildOverlayVisibilityCondition,
} from "../db/helpers";

const getOverlaysInViewportSchema = z.object({
  bbox: z.object({
    minLng: z.number().min(-180).max(180),
    minLat: z.number().min(-90).max(90),
    maxLng: z.number().min(-180).max(180),
    maxLat: z.number().min(-90).max(90),
  }),
  mode: z.enum(["view", "edit", "moderation"]).optional().default("view"),
});

export const viewportRouter = router({
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

        // Bbox condition on overlay centroid using ST_Intersects
        const bboxCondition = sql`ST_Intersects(
          ${overlays.centroid},
          ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)
        )`;

        const whereConditions = [
          bboxCondition,
          buildProjectVisibilityCondition(ctx.user, mode, false),
          buildOverlayVisibilityCondition(ctx.user, mode, overlayChangeRequestIds),
        ];

        const overlaysData = await db
          .select({
            overlayId: overlays.id,
            overlayVersion: overlays.version,
            overlayFilename: overlays.filename,
            overlayCaption: overlays.caption,
            overlayStatus: overlays.status,
            overlayProjectId: overlays.projectId,
            overlayAuthorId: overlays.authorId,
            overlayReplacesOverlayId: overlays.replacesOverlayId,
            overlayReplacedByOverlayId: overlays.replacedByOverlayId,
            overlayCreatedAt: overlays.createdAt,
            overlayUpdatedAt: overlays.updatedAt,
            centroidLat: sql<number>`ST_Y(${overlays.centroid})`,
            centroidLng: sql<number>`ST_X(${overlays.centroid})`,
            corners: sql<{ lat: number; lng: number }[]>`(
              SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
              FROM ST_DumpPoints(${overlays.corners}) AS dump(path, geom)
              WHERE path[2] <= 4
            )`,
            project: {
              ...projects,
              geometry: sql<GeoJSON.GeometryCollection | null>`CASE WHEN ${projects.geometry} IS NULL THEN NULL ELSE ST_AsGeoJSON(${projects.geometry})::json END`,
            },
            city: cities,
          })
          .from(overlays)
          .innerJoin(projects, eq(projects.id, overlays.projectId))
          .innerJoin(cities, eq(cities.id, projects.cityId))
          .where(and(...whereConditions))
          .orderBy(overlays.createdAt);

        // Fetch change requests based on mode (mirrors getCityOverlaysAndProjects logic)
        let changeRequestsData: {
          id: string;
          entityType: string;
          entityId: string;
          fieldName: string;
          newValue: unknown;
          requestedBy: string | null;
        }[] = [];

        if (ctx.user) {
          if (mode === "edit") {
            changeRequestsData = await db
              .select({
                id: changeRequests.id,
                entityType: changeRequests.entityType,
                entityId: changeRequests.entityId,
                fieldName: changeRequests.fieldName,
                newValue: changeRequests.newValue,
                requestedBy: changeRequests.requestedBy,
              })
              .from(changeRequests)
              .where(
                and(
                  eq(changeRequests.requestedBy, ctx.user.id),
                  eq(changeRequests.entityType, "overlay"),
                  eq(changeRequests.status, "pending"),
                ),
              );
          } else if (mode === "moderation") {
            changeRequestsData = await db
              .select({
                id: changeRequests.id,
                entityType: changeRequests.entityType,
                entityId: changeRequests.entityId,
                fieldName: changeRequests.fieldName,
                newValue: changeRequests.newValue,
                requestedBy: changeRequests.requestedBy,
              })
              .from(changeRequests)
              .where(
                and(eq(changeRequests.entityType, "overlay"), eq(changeRequests.status, "pending")),
              );
          }
        }

        const changeRequestsByOverlay = new Map<string, typeof changeRequestsData>();
        for (const cr of changeRequestsData) {
          const existing = changeRequestsByOverlay.get(cr.entityId) ?? [];
          existing.push(cr);
          changeRequestsByOverlay.set(cr.entityId, existing);
        }

        const allChangeRequestCounts = new Map<string, number>();
        if (mode === "moderation") {
          for (const [overlayId, requests] of changeRequestsByOverlay) {
            allChangeRequestCounts.set(overlayId, requests.length);
          }
        }

        const result: OverlayData[] = overlaysData.map((row) => {
          const approvedCorners = row.corners;
          const centroid = { lat: row.centroidLat, lng: row.centroidLng };

          const overlayChangeRequests = changeRequestsByOverlay.get(row.overlayId) ?? [];

          const cornersChangeRequest = overlayChangeRequests.find(
            (cr) => cr.fieldName === "corners",
          );
          const hasPendingCorners = Boolean(cornersChangeRequest);
          const suggestedCorners =
            hasPendingCorners && cornersChangeRequest?.newValue
              ? (cornersChangeRequest.newValue as { lat: number; lng: number }[])
              : null;

          const userHasPendingChanges =
            mode === "edit" && overlayChangeRequests.some((cr) => cr.requestedBy === ctx.user?.id);

          return {
            id: row.overlayId,
            version: row.overlayVersion,
            filename: row.overlayFilename,
            caption: row.overlayCaption,
            status: row.overlayStatus,
            projectId: row.overlayProjectId,
            authorId: row.overlayAuthorId,
            replacesOverlayId: row.overlayReplacesOverlayId,
            replacedByOverlayId: row.overlayReplacedByOverlayId ?? null,
            createdAt: row.overlayCreatedAt,
            updatedAt: row.overlayUpdatedAt,
            centroid,
            corners: approvedCorners,
            suggestedCorners: suggestedCorners ?? undefined,
            distance: 0,
            project: {
              ...row.project,
              city: row.city,
            },
            hasPendingChanges: mode === "moderation" ? hasPendingCorners : userHasPendingChanges,
            pendingChangeRequestsCount:
              mode === "moderation" ? (allChangeRequestCounts.get(row.overlayId) ?? 0) : undefined,
          };
        });

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
});
