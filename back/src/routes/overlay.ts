import { publicProcedure, loggedInProcedure, router, TRPCError } from "../trpc";
import * as z from "zod";
import { overlays } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { db } from "../database";
import { buildOverlayQuery, buildOverlayVisibilityCondition } from "../db/helpers";
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
          await deleteLocalImages(deletedOverlay.filename);
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
});
