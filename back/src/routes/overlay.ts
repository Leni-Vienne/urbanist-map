import { publicProcedure, loggedInProcedure, router, TRPCError } from "../trpc";
import * as z from "zod";
import { overlays, projects, users } from "../db/schema";
import { sql, eq, and, or, inArray } from "drizzle-orm";
import { db } from "../database";
import { boundaryName, buildOverlayQuery, buildOverlayVisibilityCondition } from "../db/helpers";
import { deleteLocalImages } from "../lib/imageCleanup";

const getOverlaySchema = z.object({
  id: z.uuid(),
});

export const overlayRouter = router({
  getOverlay: publicProcedure.input(getOverlaySchema).query(async ({ input, ctx }) => {
    try {
      const mode = ctx.user ? "edit" : "view";
      const [overlay] = await buildOverlayQuery(db)
        .where(and(eq(overlays.id, input.id), buildOverlayVisibilityCondition(ctx.user, mode)))
        .limit(1);

      if (!overlay) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
      }

      return overlay;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("Error fetching overlay:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch overlay",
      });
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

        const deletedOverlays = await db
          .delete(overlays)
          .where(
            and(
              eq(overlays.id, input.id),
              eq(overlays.authorId, userId),
              eq(overlays.status, "pending"),
            ),
          )
          .returning({ filename: overlays.filename });

        const deletedOverlay = deletedOverlays[0];
        if (!deletedOverlay) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Overlay status changed while it was being deleted",
          });
        }

        try {
          await deleteLocalImages(deletedOverlay.filename, "both");
          console.log(`Deleted local images for overlay ${input.id}`);
        } catch (error) {
          console.error(`Failed to delete images for overlay ${input.id}:`, error);
          // Log to orphaned files but don't fail the deletion
          // The deleteLocalImages function handles logging internally
        }
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
          city: boundaryName("city"),
          state: boundaryName("state"),
          country: boundaryName("country"),
          tags: projects.tags,
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
          city: boundaryName("city"),
          state: boundaryName("state"),
          country: boundaryName("country"),
          tags: projects.tags,
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
      const combined = [...moderatedOverlays, ...moderatedProjects]
        .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((item) => Object.assign(item, { tags: item.tags ?? [] }));

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

        return { success: true };
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
