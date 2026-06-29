import { publicProcedure, loggedInProcedure, router, TRPCError } from "../trpc";
import * as z from "zod";
import { overlays, projects, users, type ApprovalStatus } from "../db/schema";
import { sql, eq, and, or, inArray } from "drizzle-orm";
import { db, type Database } from "../database";
import { buildOverlayQuery, buildOverlayVisibilityCondition, isUserBlocked } from "../db/helpers";
import type { AppMode } from "@shared/types";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { deleteLocalImages } from "../lib/imageCleanup";

// Country display name resolved from the level-2 (country) admin boundary matching a country_code.
const countryNameSql = sql<
  string | null
>`(SELECT ab.name FROM admin_boundaries ab WHERE ab.admin_level = 2 AND ab.country_code = ${projects.countryCode} LIMIT 1)`;
import {
  checkPendingLimitForNewContribution,
  checkTotalContributionLimit,
} from "../db/contributionHelpers";
import { overlaySchema } from "@shared/validation/schemas";
import { notifyNewSubmission } from "../services/discordNotifier";

// Use shared overlay schema for validation
const publishOverlaySchema = overlaySchema;

const getOverlaySchema = z.object({
  id: z.uuid(),
  includeIntersecting: z.boolean().optional().default(false),
  includeStatus: z.array(z.enum(["pending", "approved", "rejected"])).optional(), // Optional status filter for admins
});

// Renders are non-georeferenced project images (no corners), so they have their own
// lightweight publish schema rather than reusing the corner-centric overlaySchema.
const publishRenderSchema = z.object({
  projectId: z.uuid({ message: "validation.projectRequired" }),
  filename: z.string().min(1, "validation.filenameRequired").max(255, "validation.filenameTooLong"),
  caption: z
    .string()
    .max(500, "validation.captionTooLong")
    .or(z.literal(""))
    .transform((val) => (val === "" ? undefined : val))
    .optional(),
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

// Find overlays that intersect with a given overlay using PostGIS spatial queries
async function findIntersectingOverlays(
  database: Database,
  excludeId: string,
  targetOverlay: { corners: { lat: number; lng: number }[] },
) {
  try {
    // Construct the target polygon once as WKT string - avoids expensive polygon construction for every row
    const [topLeft, topRight, bottomRight, bottomLeft] = targetOverlay.corners;
    // oxlint-disable-next-line no-non-null-assertion
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

      if (overlay.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
      }

      let intersectingOverlays: Awaited<ReturnType<typeof findIntersectingOverlays>> = [];

      // If includeIntersecting is true, find overlays that intersect with the queried overlay.
      // Renders have no corners, so there is nothing to intersect (and the polygon build would fail).
      if (input.includeIntersecting) {
        const queriedOverlay = overlay[0];
        if (!queriedOverlay)
          throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
        if (queriedOverlay.corners.length === 4) {
          intersectingOverlays = await findIntersectingOverlays(db, input.id, queriedOverlay);
        }
      }

      return {
        overlay: overlay[0],
        intersectingOverlays,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("Error fetching overlay:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch overlay",
      });
    }
  }),

  // Publish a render (artist's impression). Goes through the same moderation queue and
  // local->R2 image lifecycle as overlays, but is not placed on the map (no corners).
  publishRender: loggedInProcedure.input(publishRenderSchema).mutation(async ({ input, ctx }) => {
    try {
      if (await isUserBlocked(ctx.user.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your account has been flagged for review. Please contact support.",
        });
      }

      await checkTotalContributionLimit(ctx.user.id);

      // Verify the project exists and grab its center for the moderation notification link.
      const projectRow = await db
        .select({ lat: projects.lat, lng: projects.lng })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);

      const project = projectRow[0];
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const id = crypto.randomUUID();
      await checkPendingLimitForNewContribution(ctx.user.id, id);

      const insertedResult = await db
        .insert(overlays)
        .values({
          id,
          filename: input.filename,
          caption: input.caption,
          projectId: input.projectId,
          authorId: ctx.user.id,
          kind: "render",
        })
        .returning({ id: overlays.id, status: overlays.status, authorId: overlays.authorId });

      const inserted = insertedResult[0];
      if (!inserted) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create render" });
      }

      void notifyNewSubmission({
        kind: "overlay",
        author: { email: ctx.user.email, username: ctx.user.username },
        overlayId: inserted.id,
        caption: input.caption ?? null,
        projectId: input.projectId,
        lat: project.lat,
        lng: project.lng,
      });

      return { id: inserted.id, status: inserted.status, authorId: inserted.authorId };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("Error publishing render:", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to publish render" });
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

      // Check if overlay already exists and verify ownership
      const existingOverlay = await db
        .select({
          status: overlays.status,
          authorId: overlays.authorId,
          filename: overlays.filename,
        })
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

      // Block modification of pending/rejected overlays not owned by current user
      if (existingOverlay[0] && existingOverlay[0].authorId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not authorized to modify this overlay",
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
      // oxlint-disable no-non-null-assertion
      const corners = sql`ST_SetSRID(ST_MakePolygon(
        ST_MakeLine(ARRAY[
          ST_MakePoint(${topLeft!.lng}, ${topLeft!.lat}),
          ST_MakePoint(${topRight!.lng}, ${topRight!.lat}),
          ST_MakePoint(${bottomRight!.lng}, ${bottomRight!.lat}),
          ST_MakePoint(${bottomLeft!.lng}, ${bottomLeft!.lat}),
          ST_MakePoint(${topLeft!.lng}, ${topLeft!.lat})
        ])
      ), 4326)`;
      // oxlint-enable no-non-null-assertion

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
        });

      const upsertedOverlay = upsertedOverlayResult[0];
      if (!upsertedOverlay) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to upsert overlay" });
      }

      const wasUpdate = Boolean(existingOverlay[0]);

      // Re-publishing a pending overlay with new image bytes (e.g. after a crop) uploads a fresh
      // file, leaving the previous one unreferenced. Pending overlays live only in local storage,
      // so delete the superseded file now rather than leaking it until the manual sweep.
      const previousFilename = existingOverlay[0]?.filename;
      if (wasUpdate && previousFilename && previousFilename !== input.filename) {
        try {
          await deleteLocalImages(previousFilename, "both");
        } catch (error) {
          console.error("Failed to delete superseded overlay image:", previousFilename, error);
        }
      }

      if (!wasUpdate) {
        void notifyNewSubmission({
          kind: "overlay",
          author: { email: ctx.user.email, username: ctx.user.username },
          overlayId: upsertedOverlay.id,
          caption: input.caption ?? null,
          projectId: input.projectId,
          lat: centroid.lat,
          lng: centroid.lng,
        });
      }

      return {
        id: upsertedOverlay.id,
        status: upsertedOverlay.status,
        authorId: upsertedOverlay.authorId,
        exists: wasUpdate,
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
      if (error instanceof TRPCError) throw error;
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
          countryCode: projects.countryCode,
          countryName: countryNameSql,
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

      // Get rejected standalone projects OR new approved projects
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
          countryCode: projects.countryCode,
          countryName: countryNameSql,
        })
        .from(projects)
        .where(
          and(
            eq(projects.ownerId, userId),
            or(
              eq(projects.status, "rejected"),
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

        const [ownedOverlays, ownedProjects] = await Promise.all([
          db
            .select({
              id: overlays.id,
              filename: overlays.filename,
              status: overlays.status,
            })
            .from(overlays)
            .where(and(inArray(overlays.id, ids), eq(overlays.authorId, userId))),
          db
            .select({
              id: projects.id,
              status: projects.status,
            })
            .from(projects)
            .where(and(inArray(projects.id, ids), eq(projects.ownerId, userId))),
        ]);

        if (ownedOverlays.length + ownedProjects.length !== ids.length) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot acknowledge contributions you do not own",
          });
        }

        let hasApprovedItems = false;
        const overlaysToDelete: typeof ownedOverlays = [];
        const projectsToDelete: typeof ownedProjects = [];

        for (const overlay of ownedOverlays) {
          if (overlay.status === "approved") {
            hasApprovedItems = true;
          } else if (overlay.status === "rejected" || overlay.status === "replaced") {
            overlaysToDelete.push(overlay);
          }
        }

        for (const project of ownedProjects) {
          if (project.status === "approved") {
            hasApprovedItems = true;
          } else if (project.status === "rejected") {
            projectsToDelete.push(project);
          }
        }

        await db.transaction(async (tx) => {
          if (hasApprovedItems) {
            await tx
              .update(users)
              .set({ lastApprovalAcknowledgementAt: new Date() })
              .where(eq(users.id, userId));
          }

          if (overlaysToDelete.length > 0) {
            await tx.delete(overlays).where(
              inArray(
                overlays.id,
                overlaysToDelete.map((o) => o.id),
              ),
            );
          }

          if (projectsToDelete.length > 0) {
            await tx.delete(projects).where(
              inArray(
                projects.id,
                projectsToDelete.map((p) => p.id),
              ),
            );
          }
        });

        // Filesystem cleanup happens after the DB commits (orphaned files are tolerable, missing rows are not).
        for (const overlay of overlaysToDelete) {
          try {
            await deleteLocalImages(overlay.filename, "thumbnail");
          } catch (error) {
            console.error(`Failed to delete thumbnail for overlay ${overlay.id}:`, error);
          }
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
