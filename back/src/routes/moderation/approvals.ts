import { moderatorProcedure } from "../../trpc";
import { checkModeratorCountryPermission, checkModeratorOverlayPermission } from "./shared";
import { invalidateProjectTiles, invalidateOverlayTiles } from "../tiles";
import { invalidateLatestContributionsCache } from "../feed";
import { projects, overlays, changeRequests, users } from "../../db/schema";
import { and, eq, or, sql, inArray, ne } from "drizzle-orm";
import { db, type Database } from "../../database";
import {
  cleanupRejectedPendingOverlay,
  cleanupReplacedApprovedOverlay,
} from "../../lib/imageCleanup";
import { TRPCError } from "@trpc/server";
import { queueR2Migration } from "../../services/r2MigrationService";
import { assignProjectBoundary } from "../../db/boundaryAssignment";
import { refreshProjectIndexable } from "../../db/indexable";
import * as z from "zod";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// A moderation attempt that lost a race (row gone, version moved, already processed). Thrown
// rather than returned so the enclosing transaction rolls back instead of committing.
class ModerationConflictError extends Error {
  public override name = "ModerationConflictError";
}

async function incrementApprovedCount(tx: Transaction, userId: string | null): Promise<void> {
  if (!userId) return;
  await tx
    .update(users)
    .set({ approvedCount: sql`${users.approvedCount} + 1` })
    .where(eq(users.id, userId));
}

async function incrementRejectedCount(tx: Transaction, userId: string | null): Promise<void> {
  if (!userId) return;
  await tx
    .update(users)
    .set({ rejectedCount: sql`${users.rejectedCount} + 1` })
    .where(eq(users.id, userId));
}

// Schema for version-aware approval to prevent race conditions
const setApprovalStatusWithVersionSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int(),
  status: z.enum(["approved", "rejected"]),
  rejectionReason: z.string().max(500).optional(),
  rejectAllOverlays: z.boolean().optional(),
});

export const approvalProcedures = {
  setProjectApprovalStatusWithVersion: moderatorProcedure
    .input(setApprovalStatusWithVersionSchema)
    .mutation(async ({ input, ctx }): Promise<{ success: boolean }> => {
      // Outside the try so its FORBIDDEN / NOT_FOUND reaches the client instead of a 500.
      await checkModeratorCountryPermission(input.id, ctx.user);

      try {
        const statusCondition =
          input.status === "rejected"
            ? or(eq(projects.status, "pending"), eq(projects.status, "approved"))
            : eq(projects.status, "pending");

        const rejectedOverlays = await db.transaction(async (tx) => {
          const updateResult = await tx
            .update(projects)
            .set({
              status: input.status,
              rejectionReason: input.status === "rejected" ? (input.rejectionReason ?? null) : null,
              version: sql`${projects.version} + 1`,
            })
            .where(
              and(
                eq(projects.id, input.id),
                eq(projects.version, input.expectedVersion),
                statusCondition,
              ),
            )
            .returning({ ownerId: projects.ownerId });

          const updatedProject = updateResult[0];
          if (!updatedProject) {
            throw new ModerationConflictError("Project gone, version moved, or already processed");
          }

          const ownerId = updatedProject.ownerId;
          if (input.status === "approved") {
            await incrementApprovedCount(tx, ownerId);
            return [];
          }

          await incrementRejectedCount(tx, ownerId);
          if (!input.rejectAllOverlays) return [];

          const pendingOverlays = await tx
            .select({
              id: overlays.id,
              filename: overlays.filename,
              authorId: overlays.authorId,
            })
            .from(overlays)
            .where(and(eq(overlays.projectId, input.id), eq(overlays.status, "pending")));

          if (pendingOverlays.length === 0) return [];

          await tx
            .update(overlays)
            .set({ status: "rejected", rejectionReason: input.rejectionReason ?? null })
            .where(and(eq(overlays.projectId, input.id), eq(overlays.status, "pending")));

          for (const overlay of pendingOverlays) {
            await incrementRejectedCount(tx, overlay.authorId);
          }

          return pendingOverlays;
        });

        // Committed: nothing below may fail the request, or the moderator retries an action that
        // already succeeded. Indexing has the daily import pass as its safety net.
        try {
          for (const overlay of rejectedOverlays) {
            try {
              await cleanupRejectedPendingOverlay(overlay.id, overlay.filename);
            } catch (error) {
              console.error(`Failed to cleanup rejected overlay: ${overlay.filename}`, error);
            }
          }

          await invalidateProjectTiles(input.id);
          invalidateLatestContributionsCache();
          await refreshProjectIndexable(input.id);
        } catch (error) {
          console.error(`Post-moderation side effects failed for project ${input.id}:`, error);
        }

        return { success: true };
      } catch (error) {
        if (error instanceof ModerationConflictError) {
          return { success: false };
        }

        console.error("Error updating project status with version:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update project status",
        });
      }
    }),

  setOverlayApprovalStatusWithVersion: moderatorProcedure
    .input(setApprovalStatusWithVersionSchema)
    .mutation(async ({ input, ctx }): Promise<{ success: boolean }> => {
      // Outside the try so its FORBIDDEN / NOT_FOUND reaches the client instead of a 500.
      await checkModeratorOverlayPermission(input.id, ctx.user);

      try {
        if (input.status === "rejected") {
          const rejectedOverlay = await db.transaction(async (tx) => {
            const overlay = await getOverlayForModeration(tx, input.id);
            await rejectOverlay(
              tx,
              input.id,
              input.expectedVersion,
              overlay.authorId,
              input.rejectionReason,
            );
            return overlay;
          });

          // Committed: cleanup must not fail the request.
          try {
            await cleanupRejectedPendingOverlay(input.id, rejectedOverlay.filename);
          } catch (error) {
            console.error(`Failed to cleanup rejected overlay ${input.id}:`, error);
          }

          return { success: true };
        }

        const approval = await db.transaction(async (tx) => {
          const overlay = await getOverlayForModeration(tx, input.id);
          const replacement = overlay.replacesOverlayId
            ? await resolveReplacementConflicts(
                tx,
                overlay.replacesOverlayId,
                input.id,
                overlay.projectId,
                ctx.user.id,
              )
            : null;

          await approveOverlay(tx, input.id, input.expectedVersion, overlay.authorId);

          return { overlay, replacement };
        });

        // Queue the approved image before optional cleanup work. Each post-commit side effect has
        // its own failure boundary so one failure cannot suppress the remaining reconciliation.
        if (process.env.NODE_ENV === "production") {
          try {
            queueR2Migration(approval.overlay.filename);
          } catch (error) {
            console.error(`Failed to queue R2 migration for overlay ${input.id}:`, error);
          }
        }

        if (approval.replacement) {
          try {
            await cleanupReplacementImages(
              approval.replacement.competingReplacements,
              approval.replacement.originalOverlay,
            );
          } catch (error) {
            console.error(`Failed to cleanup replacement images for overlay ${input.id}:`, error);
          }
        }

        await invalidateOverlayTiles(input.id);
        if (approval.replacement) {
          await invalidateOverlayTiles(approval.replacement.originalOverlay.id);
        }

        try {
          invalidateLatestContributionsCache();
        } catch (error) {
          console.error(`Failed to invalidate contribution caches for overlay ${input.id}:`, error);
        }

        // A newly approved map overlay extends the project's footprint, so re-derive its boundary.
        if (approval.overlay.kind === "map") {
          await assignProjectBoundary(approval.overlay.projectId);
        }

        // An approved overlay can make its project newly indexable (visual content gate).
        await refreshProjectIndexable(approval.overlay.projectId);

        return { success: true };
      } catch (error) {
        if (error instanceof ModerationConflictError) {
          return { success: false };
        }

        console.error("Error updating overlay status with version:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update overlay status",
        });
      }
    }),
};

async function getOverlayForModeration(tx: Transaction, overlayId: string) {
  const rows = await tx
    .select({
      filename: overlays.filename,
      replacesOverlayId: overlays.replacesOverlayId,
      authorId: overlays.authorId,
      projectId: overlays.projectId,
      kind: overlays.kind,
    })
    .from(overlays)
    .where(eq(overlays.id, overlayId))
    .limit(1);

  const overlay = rows[0];
  if (!overlay?.projectId) {
    throw new ModerationConflictError("Overlay gone or detached from its project");
  }

  return { ...overlay, projectId: overlay.projectId };
}

async function rejectOverlay(
  tx: Transaction,
  overlayId: string,
  expectedVersion: number,
  authorId: string | null,
  rejectionReason?: string,
): Promise<void> {
  const result = await tx
    .update(overlays)
    .set({
      status: "rejected",
      version: sql`${overlays.version} + 1`,
      rejectionReason: rejectionReason ?? null,
    })
    .where(
      and(
        eq(overlays.id, overlayId),
        eq(overlays.version, expectedVersion),
        eq(overlays.status, "pending"),
      ),
    )
    .returning({ id: overlays.id });

  if (result.length === 0) {
    throw new ModerationConflictError("Version mismatch or already processed");
  }

  await incrementRejectedCount(tx, authorId);
}

// Retires the overlay being replaced and rejects the other pending candidates for it, returning
// those losers so their images can be cleaned up once the transaction commits.
async function resolveReplacementConflicts(
  tx: Transaction,
  replacesOverlayId: string,
  newOverlayId: string,
  projectId: string,
  moderatorId: string,
): Promise<{
  originalOverlay: { id: string; filename: string };
  competingReplacements: { id: string; filename: string }[];
}> {
  const originalOverlays = await tx
    .update(overlays)
    .set({
      status: "replaced",
      replacedByOverlayId: newOverlayId,
      version: sql`${overlays.version} + 1`,
    })
    .where(
      and(
        eq(overlays.id, replacesOverlayId),
        eq(overlays.projectId, projectId),
        eq(overlays.status, "approved"),
      ),
    )
    .returning({ id: overlays.id, filename: overlays.filename });

  const originalOverlay = originalOverlays[0];
  if (!originalOverlay) {
    throw new ModerationConflictError(
      "Original overlay is not an approved overlay from the same project",
    );
  }

  await tx
    .update(changeRequests)
    .set({
      status: "conflicted",
      resolvedAt: new Date(),
      resolvedBy: moderatorId,
    })
    .where(
      and(
        eq(changeRequests.entityType, "overlay"),
        eq(changeRequests.entityId, replacesOverlayId),
        eq(changeRequests.status, "pending"),
      ),
    );

  const competingReplacements = await tx
    .select({ id: overlays.id, filename: overlays.filename, authorId: overlays.authorId })
    .from(overlays)
    .where(
      and(
        eq(overlays.replacesOverlayId, replacesOverlayId),
        eq(overlays.projectId, projectId),
        eq(overlays.status, "pending"),
        ne(overlays.id, newOverlayId),
      ),
    );

  if (competingReplacements.length > 0) {
    await tx
      .update(overlays)
      .set({
        status: "rejected",
        version: sql`${overlays.version} + 1`,
      })
      .where(
        inArray(
          overlays.id,
          competingReplacements.map((o: { id: string }) => o.id),
        ),
      );

    for (const competing of competingReplacements) {
      await incrementRejectedCount(tx, competing.authorId);
    }
  }

  return { originalOverlay, competingReplacements };
}

async function approveOverlay(
  tx: Transaction,
  overlayId: string,
  expectedVersion: number,
  authorId: string | null,
): Promise<void> {
  // The version + status guard belongs in the UPDATE itself: a preceding SELECT wouldn't lock the
  // row, so two concurrent approvals could both pass it and apply the side effects twice.
  const result = await tx
    .update(overlays)
    .set({
      status: "approved",
      version: sql`${overlays.version} + 1`,
      replacesOverlayId: null,
    })
    .where(
      and(
        eq(overlays.id, overlayId),
        eq(overlays.version, expectedVersion),
        eq(overlays.status, "pending"),
      ),
    )
    .returning({ projectId: overlays.projectId });

  const approvedOverlay = result[0];
  if (!approvedOverlay) {
    throw new ModerationConflictError("Version mismatch or already processed");
  }

  const approvedProjectId = approvedOverlay.projectId;
  if (approvedProjectId) {
    await tx
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, approvedProjectId));
  }

  await incrementApprovedCount(tx, authorId);
}

async function cleanupReplacementImages(
  competingReplacements: { id: string; filename: string }[],
  originalOverlay: { id: string; filename: string },
): Promise<void> {
  for (const competing of competingReplacements) {
    try {
      await cleanupRejectedPendingOverlay(competing.id, competing.filename);
    } catch (error) {
      console.error(`Failed to cleanup competing replacement ${competing.id}:`, error);
    }
  }

  await cleanupReplacedApprovedOverlay(originalOverlay.id, originalOverlay.filename);
}
