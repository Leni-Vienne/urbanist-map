import { moderatorProcedure } from "../../trpc";
import { checkModeratorCountryPermission, checkModeratorOverlayPermission } from "./shared";
import { invalidateProjectTiles, invalidateOverlayTiles } from "../tiles";
import { invalidateLatestContributionsCache } from "../feed";
import { projects, overlays, approvalStatusEnum, changeRequests, users } from "../../db/schema";
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

type DbOrTx = Pick<typeof db, "update">;

async function incrementApprovedCount(tx: DbOrTx, userId: string | null): Promise<void> {
  if (!userId) return;
  await tx
    .update(users)
    .set({ approvedCount: sql`${users.approvedCount} + 1` })
    .where(eq(users.id, userId));
}

async function incrementRejectedCount(tx: DbOrTx, userId: string | null): Promise<void> {
  if (!userId) return;
  await tx
    .update(users)
    .set({ rejectedCount: sql`${users.rejectedCount} + 1` })
    .where(eq(users.id, userId));
}

async function decrementApprovedCount(tx: DbOrTx, userId: string | null): Promise<void> {
  if (!userId) return;
  await tx
    .update(users)
    .set({ approvedCount: sql`GREATEST(${users.approvedCount} - 1, 0)` })
    .where(eq(users.id, userId));
}

async function decrementRejectedCount(tx: DbOrTx, userId: string | null): Promise<void> {
  if (!userId) return;
  await tx
    .update(users)
    .set({ rejectedCount: sql`GREATEST(${users.rejectedCount} - 1, 0)` })
    .where(eq(users.id, userId));
}

// Schema for legacy undo approval endpoints
const setApprovalStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(approvalStatusEnum.enumValues),
});

// Schema for version-aware approval to prevent race conditions
const setApprovalStatusWithVersionSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int(),
  status: z.enum(approvalStatusEnum.enumValues),
  rejectionReason: z.string().max(500).optional(),
  rejectAllOverlays: z.boolean().optional(),
});

export const approvalProcedures = {
  undoProjectApprovalStatus: moderatorProcedure
    .input(setApprovalStatusSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        await checkModeratorCountryPermission(input.id, ctx.user);

        await db.transaction(async (tx) => {
          const currentProject = await tx
            .select({ status: projects.status, ownerId: projects.ownerId })
            .from(projects)
            .where(eq(projects.id, input.id))
            .limit(1);

          const projectRecord = currentProject[0];

          if (!projectRecord) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
          }

          const previousStatus = projectRecord.status;
          const ownerId = projectRecord.ownerId;

          await tx.update(projects).set({ status: input.status }).where(eq(projects.id, input.id));

          if (previousStatus === "approved") {
            await decrementApprovedCount(tx, ownerId);
          } else if (previousStatus === "rejected") {
            await decrementRejectedCount(tx, ownerId);
          }
        });

        await invalidateProjectTiles(input.id);
        return { success: true };
      } catch (error) {
        console.error("Error updating project status:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update project status",
        });
      }
    }),

  undoOverlayApprovalStatus: moderatorProcedure
    .input(setApprovalStatusSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        await checkModeratorOverlayPermission(input.id, ctx.user);

        const undone = await db.transaction(async (tx) => {
          const currentOverlay = await tx
            .select({
              status: overlays.status,
              authorId: overlays.authorId,
              projectId: overlays.projectId,
              kind: overlays.kind,
            })
            .from(overlays)
            .where(eq(overlays.id, input.id))
            .limit(1);

          const overlayRecord = currentOverlay[0];

          if (!overlayRecord) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
          }

          const previousStatus = overlayRecord.status;
          const authorId = overlayRecord.authorId;

          await tx.update(overlays).set({ status: input.status }).where(eq(overlays.id, input.id));

          if (previousStatus === "approved") {
            await decrementApprovedCount(tx, authorId);
          } else if (previousStatus === "rejected") {
            await decrementRejectedCount(tx, authorId);
          }

          return { previousStatus, projectId: overlayRecord.projectId, kind: overlayRecord.kind };
        });

        await invalidateOverlayTiles(input.id);

        // Un-approving a map overlay drops its corners from the project's footprint, so re-derive
        // its boundary. Best-effort, post-commit.
        if (undone.previousStatus === "approved" && undone.kind === "map" && undone.projectId) {
          await assignProjectBoundary(undone.projectId);
        }

        return { success: true };
      } catch (error) {
        console.error("Error updating overlay status:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update overlay status",
        });
      }
    }),

  setProjectApprovalStatusWithVersion: moderatorProcedure
    .input(setApprovalStatusWithVersionSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        await checkModeratorCountryPermission(input.id, ctx.user);

        const statusCondition =
          input.status === "rejected"
            ? or(eq(projects.status, "pending"), eq(projects.status, "approved"))
            : eq(projects.status, "pending");

        const result = await db.transaction(async (tx) => {
          const updateResult = await tx
            .update(projects)
            .set({
              status: input.status,
              rejectionReason: input.status === "rejected" ? (input.rejectionReason ?? null) : null,
            })
            .where(
              and(
                eq(projects.id, input.id),
                eq(projects.version, input.expectedVersion),
                statusCondition,
              ),
            )
            .returning({
              id: projects.id,
              version: projects.version,
              ownerId: projects.ownerId,
            });

          const updatedProject = updateResult[0];
          if (!updatedProject) {
            // Either project doesn't exist, version mismatch, or status not allowed
            const currentProject = await tx
              .select({ version: projects.version, status: projects.status })
              .from(projects)
              .where(eq(projects.id, input.id))
              .limit(1);

            const projectRecord = currentProject[0];

            if (!projectRecord) {
              return { success: false, error: "Project not found" };
            } else if (
              projectRecord.status !== "pending" &&
              !(input.status === "rejected" && projectRecord.status === "approved")
            ) {
              return {
                success: false,
                error: "Project already processed",
                currentStatus: projectRecord.status,
              };
            } else {
              return {
                success: false,
                error: "Version mismatch",
                expectedVersion: input.expectedVersion,
                currentVersion: projectRecord.version,
              };
            }
          }

          const ownerId = updatedProject.ownerId;
          if (input.status === "approved") {
            await incrementApprovedCount(tx, ownerId);
          } else if (input.status === "rejected") {
            await incrementRejectedCount(tx, ownerId);

            let rejectedOverlayFilenames: string[] = [];
            if (input.rejectAllOverlays) {
              const pendingOverlays = await tx
                .select({
                  id: overlays.id,
                  filename: overlays.filename,
                  authorId: overlays.authorId,
                })
                .from(overlays)
                .where(and(eq(overlays.projectId, input.id), eq(overlays.status, "pending")));

              if (pendingOverlays.length > 0) {
                await tx
                  .update(overlays)
                  .set({ status: "rejected", rejectionReason: input.rejectionReason ?? null })
                  .where(and(eq(overlays.projectId, input.id), eq(overlays.status, "pending")));

                for (const overlay of pendingOverlays) {
                  await incrementRejectedCount(tx, overlay.authorId);
                }

                rejectedOverlayFilenames = pendingOverlays.map((o) => o.filename);
              }
            }

            return {
              success: true as const,
              rejectedOverlayFilenames,
            };
          }

          return { success: true as const };
        });

        if (
          result.success &&
          result.rejectedOverlayFilenames &&
          result.rejectedOverlayFilenames.length > 0
        ) {
          for (const filename of result.rejectedOverlayFilenames) {
            try {
              // Use project ID as identifier (no per-overlay ID available here)
              await cleanupRejectedPendingOverlay(input.id, filename);
            } catch (error) {
              console.error(`Failed to cleanup rejected overlay: ${filename}`, error);
              // Don't fail the request if cleanup fails
            }
          }
        }

        if (result.success) await invalidateProjectTiles(input.id);

        if (result.success && input.status === "approved") {
          invalidateLatestContributionsCache();
        }

        // Approval/rejection changes whether the project qualifies for indexing. Best-effort and
        // post-commit; the daily import pass is the safety net.
        if (result.success) await refreshProjectIndexable(input.id);

        return result;
      } catch (error) {
        console.error("Error updating project status with version:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update project status",
        });
      }
    }),

  setOverlayApprovalStatusWithVersion: moderatorProcedure
    .input(
      setApprovalStatusWithVersionSchema.extend({
        handleReplacementConflicts: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await checkModeratorOverlayPermission(input.id, ctx.user);

        const overlayData = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            replacesOverlayId: overlays.replacesOverlayId,
            authorId: overlays.authorId,
            projectId: overlays.projectId,
            kind: overlays.kind,
          })
          .from(overlays)
          .where(eq(overlays.id, input.id))
          .limit(1);

        const overlay = overlayData[0];
        if (!overlay) {
          return { success: false, error: "Overlay not found" };
        }

        const overlayFilename = overlay.filename;
        const replacesOverlayId = overlay.replacesOverlayId;
        const authorId = overlay.authorId;

        if (input.status === "rejected") {
          return await handleOverlayRejection(
            input.id,
            input.expectedVersion,
            authorId,
            overlayFilename,
            input.rejectionReason,
          );
        }

        const transactionResult = await db.transaction(async (tx) => {
          const currentOverlay = await tx
            .select({
              id: overlays.id,
              status: overlays.status,
              version: overlays.version,
              replacesOverlayId: overlays.replacesOverlayId,
            })
            .from(overlays)
            .where(eq(overlays.id, input.id))
            .limit(1);

          const overlayRecord = currentOverlay[0];

          if (!overlayRecord) {
            return { success: false, error: "Overlay not found" };
          }

          if (overlayRecord.version !== input.expectedVersion) {
            return {
              success: false,
              error: "Version mismatch",
              expectedVersion: input.expectedVersion,
              currentVersion: overlayRecord.version,
            };
          }

          if (overlayRecord.status !== "pending") {
            return {
              success: false,
              error: "Overlay already processed",
              currentStatus: overlayRecord.status,
            };
          }

          let competingReplacements: { id: string; filename: string; authorId: string | null }[] =
            [];
          if (replacesOverlayId && input.handleReplacementConflicts) {
            const replacementResult = await handleReplacementConflicts(
              tx,
              replacesOverlayId,
              input.id,
              ctx.user.id,
            );

            if (!replacementResult.success) {
              return { success: false, error: replacementResult.error };
            }

            competingReplacements = replacementResult.competingReplacements;
          }

          const approvalResult = await handleOverlayApproval(
            tx,
            input.id,
            input.expectedVersion,
            authorId,
          );

          if (!approvalResult.success) {
            return { success: false, error: approvalResult.error };
          }

          return {
            success: true,
            competingReplacements: replacesOverlayId ? competingReplacements : [],
          };
        });

        if (!transactionResult.success) {
          return transactionResult;
        }

        if (replacesOverlayId && input.handleReplacementConflicts) {
          await cleanupReplacementImages(
            transactionResult.competingReplacements ?? [],
            replacesOverlayId,
          );
        }

        // Rejection returned early above, so this path always approves the overlay.
        if (overlayFilename && process.env.NODE_ENV === "production") {
          queueR2Migration(overlayFilename);
        }

        await invalidateOverlayTiles(input.id);
        invalidateLatestContributionsCache();

        // A newly approved map overlay extends the project's footprint, so re-derive its boundary.
        // Best-effort and post-commit: never blocks or rolls back the approval.
        if (overlay.kind === "map" && overlay.projectId) {
          await assignProjectBoundary(overlay.projectId);
        }

        // An approved overlay can make its project newly indexable (visual content gate).
        if (overlay.projectId) await refreshProjectIndexable(overlay.projectId);

        return transactionResult;
      } catch (error) {
        console.error("Error updating overlay status with version:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update overlay status",
        });
      }
    }),
};

async function handleOverlayRejection(
  overlayId: string,
  expectedVersion: number,
  authorId: string | null,
  filename: string,
  rejectionReason?: string,
): Promise<{ success: boolean; error?: string }> {
  const rejectionResult = await db.transaction(async (tx) => {
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
      .returning({ id: overlays.id, version: overlays.version });

    if (result.length === 0) {
      return { success: false as const, error: "Version mismatch or already processed" };
    }

    await incrementRejectedCount(tx, authorId);

    return { success: true as const };
  });

  if (!rejectionResult.success) {
    return rejectionResult;
  }

  try {
    await cleanupRejectedPendingOverlay(overlayId, filename);
  } catch (error) {
    console.error("Failed to cleanup rejected overlay images:", error);
    // Don't fail the rejection if cleanup fails
  }

  return { success: true };
}

async function handleReplacementConflicts(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  replacesOverlayId: string,
  newOverlayId: string,
  moderatorId: string,
): Promise<{
  success: boolean;
  error?: string;
  competingReplacements: { id: string; filename: string; authorId: string | null }[];
}> {
  const originalOverlay = await tx
    .select({
      id: overlays.id,
      status: overlays.status,
      version: overlays.version,
      filename: overlays.filename,
    })
    .from(overlays)
    .where(eq(overlays.id, replacesOverlayId))
    .limit(1);

  const originalRecord = originalOverlay[0];

  if (originalRecord?.status !== "approved") {
    return {
      success: false,
      error: "Original overlay not found or not approved",
      competingReplacements: [],
    };
  }

  await tx
    .update(overlays)
    .set({
      status: "replaced",
      replacedByOverlayId: newOverlayId,
      version: sql`${overlays.version} + 1`,
    })
    .where(eq(overlays.id, replacesOverlayId));

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

  return { success: true, competingReplacements };
}

async function handleOverlayApproval(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  overlayId: string,
  expectedVersion: number,
  authorId: string | null,
): Promise<{ success: boolean; error?: string }> {
  // Guard the UPDATE on version so two concurrent approvals can't both apply the
  // side effects (the prior SELECT doesn't lock the row; this closes the race).
  const result = await tx
    .update(overlays)
    .set({
      status: "approved",
      version: sql`${overlays.version} + 1`,
      replacesOverlayId: null,
    })
    .where(and(eq(overlays.id, overlayId), eq(overlays.version, expectedVersion)))
    .returning({ id: overlays.id, projectId: overlays.projectId });

  const approvedOverlay = result[0];
  if (!approvedOverlay) {
    return { success: false, error: "Version mismatch or already processed" };
  }

  const approvedProjectId = approvedOverlay.projectId;
  if (approvedProjectId) {
    await tx
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, approvedProjectId));
  }

  await incrementApprovedCount(tx, authorId);

  return { success: true };
}

async function cleanupReplacementImages(
  competingReplacements: { id: string; filename: string }[],
  replacesOverlayId: string,
): Promise<void> {
  try {
    for (const competing of competingReplacements) {
      try {
        await cleanupRejectedPendingOverlay(competing.id, competing.filename);
      } catch (error) {
        console.error(`Failed to cleanup competing replacement ${competing.id}:`, error);
      }
    }

    const originalOverlayData = await db
      .select({ filename: overlays.filename })
      .from(overlays)
      .where(eq(overlays.id, replacesOverlayId))
      .limit(1);

    const originalRecord = originalOverlayData[0];

    if (originalRecord) {
      await cleanupReplacedApprovedOverlay(replacesOverlayId, originalRecord.filename);
    }
  } catch (error) {
    console.error("Failed to cleanup replacement images:", error);
  }
}
