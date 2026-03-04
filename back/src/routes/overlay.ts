import { publicProcedure, loggedInProcedure, router, TRPCError } from "../trpc";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import { overlays, projects, cities, countries, users, type ApprovalStatus } from "../db/schema";
import type * as schema from "../db/schema";
import { sql, eq, and, or, inArray } from "drizzle-orm";
import { db } from "../database";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { buildOverlayQuery, buildOverlayVisibilityCondition, isUserBlocked } from "../db/helpers";
import type { AppMode } from "@shared/types";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { deleteLocalImages } from "../lib/imageCleanup";
import {
  checkPendingLimitForNewContribution,
  checkTotalContributionLimit,
} from "../db/contributionHelpers";
import { overlaySchema } from "@shared/validation/schemas";

// Use shared overlay schema for validation
const publishOverlaySchema = overlaySchema;

const getOverlaySchema = z.object({
  id: z.uuid(),
  includeIntersecting: z.boolean().optional().default(false),
  includeStatus: z.array(z.enum(["pending", "approved", "rejected"])).optional(), // Optional status filter for admins
});

// Schema for getting latest contributions (overlays + standalone projects)
const getLatestContributionsSchema = z.object({
  limit: z.number().min(1).max(20).optional().default(20),
});

// Schema for updating overlay fields directly
const updateOverlaySchema = z.object({
  id: z.uuid(),
  caption: z
    .string()
    .max(500)
    .or(z.literal(""))
    .transform((val) => (val === "" ? undefined : val))
    .optional(), // Allow updating caption
});

// Shared select fields and query builder moved to back/src/db/queryBuilders.ts to eliminate duplication

// Find overlays that intersect with a given overlay using PostGIS spatial queries
async function findIntersectingOverlays(
  database: BunSQLDatabase<typeof schema>,
  excludeId: string,
  targetOverlay: { corners: { lat: number; lng: number }[] },
) {
  try {
    // Construct the target polygon once as WKT string - avoids expensive polygon construction for every row
    const [topLeft, topRight, bottomRight, bottomLeft] = targetOverlay.corners;
    const targetPolygonWKT = `POLYGON((${topLeft!.lng} ${topLeft!.lat}, ${topRight!.lng} ${topRight!.lat}, ${bottomRight!.lng} ${bottomRight!.lat}, ${bottomLeft!.lng} ${bottomLeft!.lat}, ${topLeft!.lng} ${topLeft!.lat}))`;

    // Use PostGIS ST_Intersects with precomputed target polygon for optimal performance
    // Only return approved overlays
    const intersectingOverlays = await buildOverlayQuery(database).where(sql`
        ${overlays.id} != ${excludeId} AND
        ${overlays.status} = 'approved' AND
        ST_Intersects(
          ST_GeomFromText(${targetPolygonWKT}, 4326),
          ${overlays.corners}
        )
      `);

    return intersectingOverlays;
  } catch (error) {
    console.error("Error finding intersecting overlays:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to find intersecting overlays",
    });
  }
}

export const overlayRouter = router({
  // Get latest contributions (overlays + standalone projects combined)
  getLatestContributions: publicProcedure
    .input(getLatestContributionsSchema)
    .query(async ({ input }) => {
      try {
        // Fetch overlays with their project and location info
        const latestOverlays = await buildOverlayQuery(db)
          .where(and(eq(overlays.status, "approved"), eq(projects.status, "approved")))
          .orderBy(sql`${overlays.updatedAt} DESC`)
          .limit(input.limit);

        // Fetch projects without overlays (standalone projects) with location info
        const latestStandaloneProjects = await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            status: projects.status,
            lat: projects.lat,
            lng: projects.lng,
            updatedAt: projects.updatedAt,
            cityId: cities.id,
            cityName: cities.name,
            countryCode: countries.code,
            countryName: countries.name,
          })
          .from(projects)
          .innerJoin(cities, eq(projects.cityId, cities.id))
          .leftJoin(countries, eq(cities.countryCode, countries.code))
          .leftJoin(
            overlays,
            and(eq(overlays.projectId, projects.id), eq(overlays.status, "approved")),
          )
          .where(eq(projects.status, "approved"))
          .groupBy(
            projects.id,
            projects.name,
            projects.description,
            projects.status,
            projects.lat,
            projects.lng,
            projects.updatedAt,
            cities.id,
            cities.name,
            countries.code,
            countries.name,
          )
          .having(sql`COUNT(${overlays.id}) = 0`)
          .orderBy(sql`${projects.updatedAt} DESC`)
          .limit(input.limit);

        // Transform and combine results with discriminated union type
        const overlayContributions = latestOverlays.map((o) => ({
          type: "overlay" as const,
          id: o.id,
          name: o.caption || o.projectName, // fallback to project name if caption is missing
          filename: o.filename,
          updatedAt: o.updatedAt,
          cityId: o.cityId,
          cityName: o.cityName,
          countryCode: o.countryCode,
          countryName: o.countryName,
          // Include overlay-specific fields for navigation
          centroid: o.centroid,
          status: o.status,
        }));

        const standaloneProjectContributions = latestStandaloneProjects.map((d) => ({
          type: "standalone" as const,
          id: d.id,
          name: d.name,
          filename: null as string | null,
          updatedAt: d.updatedAt,
          cityId: d.cityId,
          cityName: d.cityName,
          countryCode: d.countryCode,
          countryName: d.countryName,
          // Include standalone-project-specific fields for navigation
          lat: d.lat,
          lng: d.lng,
          status: d.status,
        }));

        // Combine and sort by updatedAt descending
        const combined = [...overlayContributions, ...standaloneProjectContributions]
          .toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, input.limit);

        return combined;
      } catch (error) {
        console.error("Error fetching latest contributions:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch latest contributions",
        });
      }
    }),

  getOverlay: publicProcedure.input(getOverlaySchema).query(async ({ input, ctx }) => {
    try {
      // Determine mode based on context - edit mode if logged in, view mode otherwise
      const mode: AppMode = ctx.user ? "edit" : "view";
      const whereConditions = [
        eq(overlays.id, input.id),
        buildOverlayVisibilityCondition(
          ctx.user,
          mode,
          undefined,
          input.includeStatus as ApprovalStatus[] | undefined,
        ),
      ];

      // Fetch the requested overlay
      const overlay = await buildOverlayQuery(db)
        .where(and(...whereConditions))
        .limit(1);

      if (!overlay.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
      }

      let intersectingOverlays: Awaited<ReturnType<typeof findIntersectingOverlays>> = [];

      // If includeIntersecting is true, find overlays that intersect with the queried overlay
      if (input.includeIntersecting) {
        const queriedOverlay = overlay[0];
        if (!queriedOverlay)
          throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
        intersectingOverlays = await findIntersectingOverlays(db, input.id, queriedOverlay);
      }

      return {
        overlay: overlay[0],
        intersectingOverlays,
      };
    } catch (error) {
      console.error("Error fetching overlay:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch overlay",
      });
    }
  }),

  publishOverlay: loggedInProcedure.input(publishOverlaySchema).mutation(async ({ input, ctx }) => {
    try {
      // Spam prevention - block banned or heavily reported users
      if (await isUserBlocked(ctx.user.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your account has been flagged for review. Please contact support.",
        });
      }

      // Check contribution limits
      // Only check total limit if it's a NEW overlay (updates/re-submissions handled by pending limit checks)
      // Note: upsert logic below handles ID existence, but for limit we conservatively check before DB op
      await checkTotalContributionLimit(ctx.user.id);

      // Check pending contribution limit for new overlays
      await checkPendingLimitForNewContribution(ctx.user.id, input.id);

      // Check if overlay already exists - approved overlays cannot be directly modified
      const existingOverlay = await db
        .select({ status: overlays.status })
        .from(overlays)
        .where(eq(overlays.id, input.id))
        .limit(1);

      // Block any modification to approved overlays - must use change request system
      if (existingOverlay[0]?.status === "approved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "APPROVED_OVERLAY_REQUIRES_CHANGE_REQUEST",
          cause:
            "Modifying an approved overlay requires moderation approval. Please submit a change request instead.",
        });
      }

      // Extract corner coordinates
      const [topLeft, topRight, bottomRight, bottomLeft] = input.corners;

      // Calculate centroid using shared utility for consistency with frontend
      const centroid = calculateCentroidFromCorners(input.corners);
      if (!centroid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid corner coordinates",
        });
      }

      // Build polygon using parameterized PostGIS functions to prevent SQL injection
      // SECURITY: Do NOT use sql.raw() with string concatenation - it bypasses parameterization
      // ST_MakePolygon creates a polygon from a LineString (ring)
      // ST_MakeLine creates a LineString from individual points
      const corners = sql`ST_MakePolygon(
        ST_MakeLine(ARRAY[
          ST_SetSRID(ST_MakePoint(${topLeft!.lng}, ${topLeft!.lat}), 4326),
          ST_SetSRID(ST_MakePoint(${topRight!.lng}, ${topRight!.lat}), 4326),
          ST_SetSRID(ST_MakePoint(${bottomRight!.lng}, ${bottomRight!.lat}), 4326),
          ST_SetSRID(ST_MakePoint(${bottomLeft!.lng}, ${bottomLeft!.lat}), 4326),
          ST_SetSRID(ST_MakePoint(${topLeft!.lng}, ${topLeft!.lat}), 4326)
        ])
      )`;

      // Prepare overlay data for insert/update
      const overlayData = {
        id: input.id,
        filename: input.filename,
        caption: input.caption,
        projectId: input.projectId,
        authorId: ctx.user.id,
        replacesOverlayId: input.replacesOverlayId ?? null,
        corners,
        centroid: sql`ST_SetSRID(ST_MakePoint(${centroid.lng}, ${centroid.lat}), 4326)`,
      };

      // Use upsert operation to avoid race conditions - atomic insert or update
      const upsertedOverlayResult = await db
        .insert(overlays)
        .values(overlayData)
        .onConflictDoUpdate({
          target: overlays.id,
          set: {
            filename: overlayData.filename,
            caption: overlayData.caption,
            projectId: overlayData.projectId,
            authorId: overlayData.authorId,
            replacesOverlayId: overlayData.replacesOverlayId,
            corners: overlayData.corners,
            centroid: overlayData.centroid,
            version: sql`${overlays.version} + 1`, // Increment version on update for optimistic locking
            updatedAt: sql`NOW()`,
          },
        })
        .returning({
          id: overlays.id,
          status: overlays.status,
          authorId: overlays.authorId,
          createdAt: overlays.createdAt,
          updatedAt: overlays.updatedAt,
        });

      const upsertedOverlay = upsertedOverlayResult[0];
      if (!upsertedOverlay) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to upsert overlay" });
      }

      return {
        id: upsertedOverlay.id,
        status: upsertedOverlay.status,
        authorId: upsertedOverlay.authorId,
        exists: upsertedOverlay.createdAt !== upsertedOverlay.updatedAt, // Determine if it was update or insert
      };
    } catch (error) {
      // Re-throw TRPCErrors as-is to preserve error codes and messages
      if (error instanceof TRPCError) {
        throw error;
      }
      // Log and wrap unexpected errors
      console.error("Error publishing overlay:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to publish overlay",
      });
    }
  }), // Update overlay fields directly (for pending overlays)
  updateOverlay: loggedInProcedure.input(updateOverlaySchema).mutation(async ({ input, ctx }) => {
    try {
      const userId = ctx.user.id;

      // Only allow owners to update their own overlays
      const existingOverlay = await db
        .select({ authorId: overlays.authorId })
        .from(overlays)
        .where(eq(overlays.id, input.id))
        .limit(1);

      const overlayToUpdate = existingOverlay[0];

      if (!overlayToUpdate) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
      }

      if (overlayToUpdate.authorId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not authorized to update this overlay",
        });
      }

      // Update only the provided fields
      const updateData: Partial<{ caption: string }> = {};
      if (input.caption !== undefined) {
        updateData.caption = input.caption;
      }

      await db
        .update(overlays)
        .set({ ...updateData, version: sql`${overlays.version} + 1`, updatedAt: new Date() }) // Increment version on update for optimistic locking
        .where(eq(overlays.id, input.id));

      return { success: true };
    } catch (error) {
      console.error("Error updating overlay:", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to update overlay" });
    }
  }),

  // Delete overlay (only pending overlays can be deleted by their owner)
  deleteOverlay: loggedInProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;

        // Get overlay to check permissions and status
        const overlay = await db
          .select({
            id: overlays.id,
            authorId: overlays.authorId,
            status: overlays.status,
            filename: overlays.filename,
          })
          .from(overlays)
          .where(eq(overlays.id, input.id))
          .limit(1);

        const overlayToDelete = overlay[0];

        if (!overlayToDelete) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
        }

        // Only owner can delete their own overlay
        if (overlayToDelete.authorId !== userId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to delete this overlay",
          });
        }

        // Only pending overlays can be deleted
        if (overlayToDelete.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Can only delete pending overlays",
          });
        }

        // Delete images first (safer - if DB delete fails, we just have orphaned files)
        try {
          await deleteLocalImages(overlayToDelete.filename, "both");
          console.log(`Deleted local images for overlay ${input.id}`);
        } catch (error) {
          console.error(`Failed to delete images for overlay ${input.id}:`, error);
          // Log to orphaned files but don't fail the deletion
          // The deleteLocalImages function handles logging internally
        }

        // Delete from database
        await db.delete(overlays).where(eq(overlays.id, input.id));

        return { success: true };
      } catch (error) {
        console.error("Error deleting overlay:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to delete overlay" });
      }
    }),

  // Get moderated contributions (rejected/replaced overlays AND standalone projects) for the current user
  getModeratedContributions: loggedInProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.user.id;

      // Get user's last acknowledgement time
      const currentUser = await db
        .select({ lastApprovalAcknowledgementAt: users.lastApprovalAcknowledgementAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const lastAck = currentUser[0]?.lastApprovalAcknowledgementAt ?? new Date(0);

      // Get rejected/replaced overlays OR new approved overlays
      const moderatedOverlays = await db
        .select({
          id: overlays.id,
          type: sql<"overlay">`'overlay'`,
          caption: overlays.caption,
          filename: overlays.filename,
          status: overlays.status,
          rejectionReason: overlays.rejectionReason, // Include rejection reason for display
          updatedAt: overlays.updatedAt,
          projectId: overlays.projectId,
          replacedByOverlayId: overlays.replacedByOverlayId,
          projectName: projects.name,
          lat: sql<number | null>`NULL`,
          lng: sql<number | null>`NULL`,
          cityId: sql<string | null>`NULL`,
          cityName: sql<string | null>`NULL`,
          countryCode: sql<string | null>`NULL`,
        })
        .from(overlays)
        .leftJoin(projects, eq(overlays.projectId, projects.id))
        .where(
          and(
            eq(overlays.authorId, userId),
            or(
              sql`${overlays.status} IN ('rejected', 'replaced')`,
              and(eq(overlays.status, "approved"), sql`${overlays.updatedAt} > ${lastAck}`),
            ),
          ),
        );

      // Get rejected/replaced standalone projects OR new approved projects
      const moderatedProjects = await db
        .select({
          id: projects.id,
          type: sql<"standalone">`'standalone'`,
          caption: projects.name,
          filename: sql<string | null>`NULL`,
          status: projects.status,
          rejectionReason: projects.rejectionReason,
          updatedAt: projects.updatedAt,
          projectId: projects.id,
          replacedByOverlayId: sql<string | null>`NULL`,
          projectName: projects.name,
          lat: projects.lat,
          lng: projects.lng,
          cityId: projects.cityId,
          cityName: cities.name,
          countryCode: cities.countryCode,
        })
        .from(projects)
        .leftJoin(cities, eq(projects.cityId, cities.id))
        .where(
          and(
            eq(projects.ownerId, userId),
            or(
              sql`${projects.status} IN ('rejected', 'replaced')`,
              and(eq(projects.status, "approved"), sql`${projects.updatedAt} > ${lastAck}`),
            ),
          ),
        );

      // Combine and sort by updatedAt
      const combined = [...moderatedOverlays, ...moderatedProjects].toSorted(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      );

      return combined;
    } catch (error) {
      console.error("Error fetching moderated contributions:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch moderated contributions",
      });
    }
  }),

  // Acknowledge/clear moderated contributions
  // For rejected/replaced items: deletes them
  // For approved items: updates user's lastApprovalAcknowledgementAt timestamp
  acknowledgeModeratedContributions: loggedInProcedure
    .input(
      z.object({
        contributionIds: z.array(z.uuid()).min(1).max(50),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;

        const ids = input.contributionIds;

        // Fetch overlays explicitly to separate approved vs rejected/replaced
        const overlaysToCheck = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            status: overlays.status,
            authorId: overlays.authorId,
          })
          .from(overlays)
          .where(
            sql`${overlays.id} IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );

        // Fetch projects explicitly
        const projectsToCheck = await db
          .select({
            id: projects.id,
            status: projects.status,
            ownerId: projects.ownerId,
          })
          .from(projects)
          .where(
            sql`${projects.id} IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );

        let hasApprovedItems = false;
        const overlaysToDelete: typeof overlaysToCheck = [];
        const projectsToDelete: typeof projectsToCheck = [];

        // Process overlays
        for (const overlay of overlaysToCheck) {
          if (overlay.authorId !== userId) continue; // Skip if not owner (or throw)

          if (overlay.status === "approved") {
            hasApprovedItems = true;
          } else if (overlay.status === "rejected" || overlay.status === "replaced") {
            overlaysToDelete.push(overlay);
          }
        }

        // Process projects
        for (const project of projectsToCheck) {
          if (project.ownerId !== userId) continue;

          if (project.status === "approved") {
            hasApprovedItems = true;
          } else if (project.status === "rejected") {
            projectsToDelete.push(project);
          }
        }

        // If any approved items matched, update user's last check time
        // We acknowledge ALL approved items by updating the timestamp, which is simpler and expected
        if (hasApprovedItems) {
          await db
            .update(users)
            .set({ lastApprovalAcknowledgementAt: new Date() })
            .where(eq(users.id, userId));
        }

        // Delete rejected/replaced overlays
        if (overlaysToDelete.length > 0) {
          // Delete images first
          for (const overlay of overlaysToDelete) {
            try {
              await deleteLocalImages(overlay.filename, "thumbnail");
            } catch (error) {
              console.error(`Failed to delete thumbnail for overlay ${overlay.id}:`, error);
            }
          }

          // Delete DB records
          await db.delete(overlays).where(
            inArray(
              overlays.id,
              overlaysToDelete.map((o) => o.id),
            ),
          );
        }

        // Delete rejected projects
        if (projectsToDelete.length > 0) {
          await db.delete(projects).where(
            inArray(
              projects.id,
              projectsToDelete.map((p) => p.id),
            ),
          );
        }

        return {
          success: true,
          deletedCount: overlaysToDelete.length + projectsToDelete.length,
          acknowledgedApproved: hasApprovedItems,
        };
      } catch (error) {
        console.error("Error acknowledging moderated contributions:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to acknowledge moderated contributions",
        });
      }
    }),
});
