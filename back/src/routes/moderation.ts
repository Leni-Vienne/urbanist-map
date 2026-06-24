import { moderatorProcedure, adminProcedure, router } from "../trpc";
import { invalidateProjectTiles, invalidateOverlayTiles } from "./tiles";
import { invalidateLatestContributionsCache } from "./feed";
import {
  projects,
  overlays,
  approvalStatusEnum,
  changeRequests,
  users,
  userReports,
  type EntityType,
} from "../db/schema";
import { and, eq, or, sql, inArray, ne, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, type Database } from "../database";
import {
  deleteImages,
  deleteLocalImages,
  cleanupRejectedPendingOverlay,
  cleanupReplacedApprovedOverlay,
} from "../lib/imageCleanup";
import { TRPCError } from "@trpc/server";
import {
  buildProjectModerationQuery,
  buildOverlayModerationQuery,
  buildPaginationConditions,
  buildPaginationResponse,
  addConflictFlags,
} from "../db/helpers";
import { queueR2Migration } from "../services/r2MigrationService";
import { assignProjectBoundary } from "../db/boundaryAssignment";
import { refreshProjectIndexable } from "../db/indexable";
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
  id: z.string().uuid(),
  status: z.enum(approvalStatusEnum.enumValues),
});

// Helper to check if moderator has permission for a project's country
// Returns the country code if permitted, throws FORBIDDEN if not
async function checkModeratorCountryPermission(
  projectId: string,
  user: { role: string | null; moderatedCountries: string[] | null },
): Promise<string> {
  if (user.role === "admin") {
    return "*"; // Wildcard indicating all countries allowed
  }

  const projectCountry = await db
    .select({ countryCode: projects.countryCode })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const projectData = projectCountry[0];

  if (!projectData) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  const countryCode = projectData.countryCode;

  if (!user.moderatedCountries?.includes(countryCode)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to moderate content in this country",
    });
  }

  return countryCode;
}

// Helper to check moderator permission for an overlay via its project
async function checkModeratorOverlayPermission(
  overlayId: string,
  user: { role: string | null; moderatedCountries: string[] | null },
): Promise<string> {
  if (user.role === "admin") {
    return "*";
  }

  const overlayCountry = await db
    .select({ countryCode: projects.countryCode })
    .from(overlays)
    .innerJoin(projects, eq(overlays.projectId, projects.id))
    .where(eq(overlays.id, overlayId))
    .limit(1);

  const overlayData = overlayCountry[0];

  if (!overlayData) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
  }

  const countryCode = overlayData.countryCode;

  if (!user.moderatedCountries?.includes(countryCode)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to moderate content in this country",
    });
  }

  return countryCode;
}

// Schema for version-aware approval to prevent race conditions
const setApprovalStatusWithVersionSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int(),
  status: z.enum(approvalStatusEnum.enumValues),
  rejectionReason: z.string().max(500).optional(),
  rejectAllOverlays: z.boolean().optional(),
});

export const moderationRouter = router({
  checkReplacementConflicts: moderatorProcedure
    .input(z.object({ overlayId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      try {
        await checkModeratorOverlayPermission(input.overlayId, ctx.user);
        const overlay = await db
          .select({
            id: overlays.id,
            replacesOverlayId: overlays.replacesOverlayId,
            filename: overlays.filename,
            caption: overlays.caption,
          })
          .from(overlays)
          .where(eq(overlays.id, input.overlayId))
          .limit(1);

        const overlayRecord = overlay[0];

        if (!overlayRecord) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
        }

        const replacesOverlayId = overlayRecord.replacesOverlayId;

        // If not a replacement, no conflicts to check
        if (!replacesOverlayId) {
          return {
            isReplacement: false,
            pendingChangeRequests: [],
            competingReplacements: [],
          };
        }

        const originalOverlay = await db
          .select({
            id: overlays.id,
            status: overlays.status,
            caption: overlays.caption,
            filename: overlays.filename,
          })
          .from(overlays)
          .where(eq(overlays.id, replacesOverlayId))
          .limit(1);

        const originalRecord = originalOverlay[0];
        if (originalRecord?.status !== "approved") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot replace overlay that is not approved",
          });
        }

        const pendingChanges = await db
          .select({
            id: changeRequests.id,
            fieldName: changeRequests.fieldName,
            oldValue: changeRequests.oldValue,
            newValue: changeRequests.newValue,
            changeReason: changeRequests.changeReason,
            requestedBy: changeRequests.requestedBy,
            createdAt: changeRequests.createdAt,
          })
          .from(changeRequests)
          .where(
            and(
              eq(changeRequests.entityType, "overlay"),
              eq(changeRequests.entityId, replacesOverlayId),
              eq(changeRequests.status, "pending"),
            ),
          );

        // Find competing replacement overlays (other pending overlays trying to replace the same original)
        const competingReplacements = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            caption: overlays.caption,
            authorId: overlays.authorId,
            createdAt: overlays.createdAt,
          })
          .from(overlays)
          .where(
            and(
              eq(overlays.replacesOverlayId, replacesOverlayId),
              eq(overlays.status, "pending"),
              ne(overlays.id, input.overlayId),
            ),
          );

        return {
          isReplacement: true,
          originalOverlayCaption: originalRecord.caption,
          originalOverlayFilename: originalRecord.filename,
          newOverlayFilename: overlayRecord.filename,
          newOverlayCaption: overlayRecord.caption,
          pendingChangeRequests: pendingChanges,
          competingReplacements,
          hasConflicts: pendingChanges.length > 0 || competingReplacements.length > 0,
        };
      } catch (error) {
        console.error("Error checking replacement conflicts:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to check replacement conflicts",
        });
      }
    }),

  getPendingSubmissions: moderatorProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).optional().default(50),
          cursor: z.string().uuid().optional(),
          sortBy: z.enum(["createdAt", "updatedAt"]).optional().default("createdAt"),
          countryCode: z.string().length(3).optional(),
        })
        .optional(),
    )
    .query(async ({ input = {}, ctx }) => {
      try {
        const sortColumn = input.sortBy === "updatedAt" ? projects.updatedAt : projects.createdAt;
        const limit = input.limit ?? 50;

        const userModeratedCountries = ctx.user.moderatedCountries;
        const isAdmin = ctx.user.role === "admin";
        const moderatorId = ctx.user.id;

        // Early permission check - validate country access before any DB queries.
        // moderatorProcedure guarantees a non-admin has a non-empty moderatedCountries,
        // so the country gate applies to every non-admin (fail closed via ?. below).
        const effectiveCountryCode = input.countryCode;

        if (!isAdmin) {
          if (!input.countryCode) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Moderators must select a country to moderate",
            });
          }

          if (!userModeratedCountries?.includes(input.countryCode)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have permission to moderate this country",
            });
          }
        }

        // Step 1: Get hidden users and pending project IDs
        const [hiddenUserIds, pendingProjectIds] = await Promise.all([
          buildHiddenUserIdsSet(moderatorId),
          collectPendingProjectIds(),
        ]);

        // Step 2: Build pagination and moderation conditions
        const paginationConditions = await buildPaginationConditions(
          { countryCode: effectiveCountryCode, cursor: input.cursor },
          sortColumn,
        );

        const projectModerationConditions = [
          or(
            eq(projects.status, "pending"),
            ...(pendingProjectIds.pendingOverlayProjectIds.length > 0
              ? [inArray(projects.id, pendingProjectIds.pendingOverlayProjectIds)]
              : []),
            ...(pendingProjectIds.pendingChangeProjectIds.length > 0
              ? [inArray(projects.id, pendingProjectIds.pendingChangeProjectIds)]
              : []),
          ),
          ...paginationConditions,
        ];

        // Step 3: Fetch all moderation data
        const { projectsResult, overlaysResult, overlayChanges, projectChanges } =
          await fetchModerationData(projectModerationConditions, sortColumn, limit);

        // Step 4: Process and filter results
        const changeRequestsResult = [...overlayChanges, ...projectChanges].toSorted(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );

        const changeRequestsWithConflictInfo = addConflictFlags(changeRequestsResult);
        const paginationResponse = buildPaginationResponse(projectsResult, limit);

        // Filter out rejected and replaced overlays
        const visibleOverlays = overlaysResult.filter(
          (overlay) => overlay.status !== "rejected" && overlay.status !== "replaced",
        );

        // Filter by reported users
        const filteredProjects = filterContentByReportedUsers(
          paginationResponse.items,
          hiddenUserIds,
          "ownerId",
        );
        const filteredOverlays = filterContentByReportedUsers(
          visibleOverlays,
          hiddenUserIds,
          "authorId",
        );
        const filteredChangeRequests = filterContentByReportedUsers(
          changeRequestsWithConflictInfo,
          hiddenUserIds,
          "requestedBy",
        );

        // Step 5: Enrich with report counts
        const { projectsWithOverlays, overlaysWithReports, changeRequestsWithReports } =
          await enrichWithReportCounts(filteredProjects, filteredOverlays, filteredChangeRequests);

        return {
          projects: projectsWithOverlays,
          overlays: overlaysWithReports,
          changeRequests: changeRequestsWithReports,
          pagination: paginationResponse.pagination,
        };
      } catch (error) {
        console.error("Error fetching pending submissions:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch pending submissions",
        });
      }
    }),

  getPendingCountsByCountry: moderatorProcedure.query(async ({ ctx }) => {
    try {
      const userModeratedCountries = ctx.user.moderatedCountries;
      const isAdmin = ctx.user.role === "admin";

      // moderatorProcedure guarantees a non-admin has a non-empty moderatedCountries.
      let countryFilter: SQL | undefined = sql`${projects.countryCode} IS NOT NULL`;
      if (!isAdmin) {
        const allowed = userModeratedCountries ?? [];
        countryFilter = sql`${projects.countryCode} = ANY(ARRAY[${sql.join(
          allowed.map((c) => sql`${c}`),
          sql`, `,
        )}]::text[])`;
      }

      // Count each pending entity type with its own simple GROUP BY, then sum
      // them per country. Counting separately avoids the combinatorial row
      // fan-out of joining projects x overlays x changeRequests in one query.
      const countByCountry = sql<string>`COUNT(*)`.as("count");

      const pendingProjects = db
        .select({ countryCode: projects.countryCode, count: countByCountry })
        .from(projects)
        .where(and(eq(projects.status, "pending"), countryFilter))
        .groupBy(projects.countryCode);

      const pendingOverlays = db
        .select({ countryCode: projects.countryCode, count: countByCountry })
        .from(overlays)
        .innerJoin(projects, eq(overlays.projectId, projects.id))
        .where(and(eq(overlays.status, "pending"), countryFilter))
        .groupBy(projects.countryCode);

      const pendingProjectChanges = db
        .select({ countryCode: projects.countryCode, count: countByCountry })
        .from(changeRequests)
        .innerJoin(projects, eq(changeRequests.entityId, projects.id))
        .where(
          and(
            eq(changeRequests.entityType, "project"),
            eq(changeRequests.status, "pending"),
            countryFilter,
          ),
        )
        .groupBy(projects.countryCode);

      const pendingOverlayChanges = db
        .select({ countryCode: projects.countryCode, count: countByCountry })
        .from(changeRequests)
        .innerJoin(overlays, eq(changeRequests.entityId, overlays.id))
        .innerJoin(projects, eq(overlays.projectId, projects.id))
        .where(
          and(
            eq(changeRequests.entityType, "overlay"),
            eq(changeRequests.status, "pending"),
            countryFilter,
          ),
        )
        .groupBy(projects.countryCode);

      const pending = pendingProjects
        .unionAll(pendingOverlays)
        .unionAll(pendingProjectChanges)
        .unionAll(pendingOverlayChanges)
        .as("pending");

      const result = await db
        .select({
          countryCode: pending.countryCode,
          total: sql<string>`SUM(${pending.count})`,
        })
        .from(pending)
        .groupBy(pending.countryCode);

      return result
        .filter((row): row is typeof row & { countryCode: string } => row.countryCode !== null)
        .map((row) => ({ countryCode: row.countryCode, total: Number(row.total) }))
        .filter((row) => row.total > 0);
    } catch (error) {
      console.error("Error fetching pending counts by country:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch pending counts",
      });
    }
  }),

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

  reportUser: moderatorProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const moderatorId = ctx.user.id;

        const existingReport = await db
          .select({ id: userReports.id })
          .from(userReports)
          .where(
            and(
              eq(userReports.reportedUserId, input.userId),
              eq(userReports.reportedBy, moderatorId),
            ),
          )
          .limit(1);

        if (existingReport.length > 0) {
          return { success: true, alreadyReported: true };
        }

        await db.insert(userReports).values({
          reportedUserId: input.userId,
          reportedBy: moderatorId,
          reason: input.reason,
        });

        const reportCount = await db
          .select({ count: sql<string>`COUNT(*)` })
          .from(userReports)
          .where(eq(userReports.reportedUserId, input.userId));

        return {
          success: true,
          alreadyReported: false,
          totalReports: Number(reportCount[0]?.count ?? 1),
        };
      } catch (error) {
        console.error("Error reporting user:", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to report user" });
      }
    }),

  unreportUser: moderatorProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const moderatorId = ctx.user.id;

        await db
          .delete(userReports)
          .where(
            and(
              eq(userReports.reportedUserId, input.userId),
              eq(userReports.reportedBy, moderatorId),
            ),
          );

        return { success: true };
      } catch (error) {
        console.error("Error unreporting user:", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to unreport user" });
      }
    }),

  getMyReportedUsers: moderatorProcedure.query(async ({ ctx }) => {
    try {
      const moderatorId = ctx.user.id;

      const reports = await db
        .select({
          id: userReports.id,
          reportedUserId: userReports.reportedUserId,
          reason: userReports.reason,
          createdAt: userReports.createdAt,
        })
        .from(userReports)
        .where(eq(userReports.reportedBy, moderatorId));

      return reports;
    } catch (error) {
      console.error("Error fetching reported users:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch reported users",
      });
    }
  }),

  getUserReportCounts: moderatorProcedure
    .input(
      z.object({
        userIds: z.array(z.string().uuid()),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        if (input.userIds.length === 0) {
          return {};
        }

        const moderatorId = ctx.user.id;
        const isAdmin = ctx.user.role === "admin";

        const reportCounts = await db
          .select({
            reportedUserId: userReports.reportedUserId,
            count: sql<string>`COUNT(*)`,
          })
          .from(userReports)
          .where(inArray(userReports.reportedUserId, input.userIds))
          .groupBy(userReports.reportedUserId);

        const myReports = await db
          .select({ reportedUserId: userReports.reportedUserId })
          .from(userReports)
          .where(
            and(
              inArray(userReports.reportedUserId, input.userIds),
              eq(userReports.reportedBy, moderatorId),
            ),
          );

        const myReportedUserIds = new Set(myReports.map((r) => r.reportedUserId));

        const result: Record<
          string,
          {
            totalReports: number;
            reportedByMe: boolean;
            isHidden: boolean;
          }
        > = {};

        for (const userId of input.userIds) {
          const count = reportCounts.find((report) => report.reportedUserId === userId);
          const totalReports = Number(count?.count ?? 0);
          const reportedByMe = myReportedUserIds.has(userId);
          // 1 report by me = hidden for me; 3+ total = hidden for all
          const isHidden = reportedByMe || (isAdmin && totalReports >= 1) || totalReports >= 3;

          result[userId] = {
            totalReports,
            reportedByMe,
            isHidden,
          };
        }

        return result;
      } catch (error) {
        console.error("Error fetching user report counts:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch user report counts",
        });
      }
    }),

  getReportedUsers: adminProcedure.query(async () => {
    try {
      const configResult = await db
        .select({ reportThreshold: sql<number>`coalesce(report_threshold, 2)` })
        .from(sql`config`)
        .limit(1);

      const threshold = configResult[0]?.reportThreshold ?? 2;

      const reportedUsers = await db
        .select({
          userId: userReports.reportedUserId,
          email: users.email,
          username: users.username,
          banned: users.banned,
          bannedAt: users.bannedAt,
          banReason: users.banReason,
          reportCount: sql<number>`count(distinct ${userReports.reportedBy})::int`,
        })
        .from(userReports)
        .leftJoin(users, eq(userReports.reportedUserId, users.id))
        .groupBy(
          userReports.reportedUserId,
          users.email,
          users.username,
          users.banned,
          users.bannedAt,
          users.banReason,
        )
        .having(sql`count(distinct ${userReports.reportedBy}) >= ${threshold}`);

      const reportedUserIds = reportedUsers.map((u) => u.userId);
      if (reportedUserIds.length === 0) {
        return [];
      }

      // Fetch reporter details and content counts for every reported user in three
      // grouped queries, then stitch them together in memory (avoids N+1).
      const [allReports, projectCounts, overlayCounts] = await Promise.all([
        db
          .select({
            reportedUserId: userReports.reportedUserId,
            reporterId: userReports.reportedBy,
            reporterUsername: users.username,
            reporterEmail: users.email,
            reason: userReports.reason,
            createdAt: userReports.createdAt,
          })
          .from(userReports)
          .leftJoin(users, eq(userReports.reportedBy, users.id))
          .where(inArray(userReports.reportedUserId, reportedUserIds)),
        db
          .select({
            ownerId: projects.ownerId,
            pending: sql<number>`count(case when status = 'pending' then 1 end)::int`,
            rejected: sql<number>`count(case when status = 'rejected' then 1 end)::int`,
          })
          .from(projects)
          .where(inArray(projects.ownerId, reportedUserIds))
          .groupBy(projects.ownerId),
        db
          .select({
            authorId: overlays.authorId,
            pending: sql<number>`count(case when status = 'pending' then 1 end)::int`,
            rejected: sql<number>`count(case when status = 'rejected' then 1 end)::int`,
          })
          .from(overlays)
          .where(inArray(overlays.authorId, reportedUserIds))
          .groupBy(overlays.authorId),
      ]);

      const reportsByUser = new Map<string, typeof allReports>();
      for (const report of allReports) {
        const list = reportsByUser.get(report.reportedUserId) ?? [];
        list.push(report);
        reportsByUser.set(report.reportedUserId, list);
      }

      const projectCountByUser = new Map(projectCounts.map((p) => [p.ownerId, p]));
      const overlayCountByUser = new Map(overlayCounts.map((o) => [o.authorId, o]));

      const enrichedUsers = reportedUsers.map((user) => {
        const reports = (reportsByUser.get(user.userId) ?? []).map((report) => ({
          reporterId: report.reporterId,
          reporterUsername: report.reporterUsername,
          reporterEmail: report.reporterEmail,
          reason: report.reason,
          createdAt: report.createdAt,
        }));
        const projectCount = projectCountByUser.get(user.userId);
        const overlayCount = overlayCountByUser.get(user.userId);

        return {
          userId: user.userId,
          email: user.email,
          username: user.username,
          banned: user.banned,
          bannedAt: user.bannedAt,
          banReason: user.banReason,
          reportCount: user.reportCount,
          reports,
          pendingProjects: projectCount?.pending ?? 0,
          rejectedProjects: projectCount?.rejected ?? 0,
          pendingOverlays: overlayCount?.pending ?? 0,
          rejectedOverlays: overlayCount?.rejected ?? 0,
        };
      });

      return enrichedUsers;
    } catch (error) {
      console.error("Error fetching reported users:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch reported users",
      });
    }
  }),

  clearUserReports: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      try {
        await db.delete(userReports).where(eq(userReports.reportedUserId, input.userId));
        return { success: true };
      } catch (error) {
        console.error("Error clearing user reports:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to clear user reports",
        });
      }
    }),

  banUser: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        reason: z.string().min(1).max(500),
        deleteContent: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({
              banned: true,
              bannedAt: new Date(),
              bannedBy: ctx.user.id,
              banReason: input.reason,
            })
            .where(eq(users.id, input.userId));

          if (input.deleteContent) {
            const overlaysToDelete = await tx
              .select({ filename: overlays.filename })
              .from(overlays)
              .where(
                and(
                  eq(overlays.authorId, input.userId),
                  or(eq(overlays.status, "pending"), eq(overlays.status, "rejected")),
                ),
              );

            await tx
              .delete(projects)
              .where(
                and(
                  eq(projects.ownerId, input.userId),
                  or(eq(projects.status, "pending"), eq(projects.status, "rejected")),
                ),
              );

            await tx
              .delete(overlays)
              .where(
                and(
                  eq(overlays.authorId, input.userId),
                  or(eq(overlays.status, "pending"), eq(overlays.status, "rejected")),
                ),
              );

            for (const overlay of overlaysToDelete) {
              try {
                await deleteLocalImages(overlay.filename, "both");
              } catch (error) {
                console.error(`Failed to delete images for ${overlay.filename}:`, error);
                // Continue with other deletions
              }
            }
          }

          await tx.delete(userReports).where(eq(userReports.reportedUserId, input.userId));
        });

        return { success: true };
      } catch (error) {
        console.error("Error banning user:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to ban user",
        });
      }
    }),

  adminDeleteOverlay: adminProcedure
    .input(
      z.object({
        id: z.uuid(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const overlayData = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            status: overlays.status,
            authorId: overlays.authorId,
            projectId: overlays.projectId,
            kind: overlays.kind,
          })
          .from(overlays)
          .where(eq(overlays.id, input.id))
          .limit(1);

        const overlay = overlayData[0];
        if (!overlay) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
        }

        await db.transaction(async (tx) => {
          // Sever replacement-chain pointers first so no sibling row is left referencing
          // the deleted overlay (these columns have no FK to cascade the cleanup).
          await tx
            .update(overlays)
            .set({ replacesOverlayId: null })
            .where(eq(overlays.replacesOverlayId, input.id));
          await tx
            .update(overlays)
            .set({ replacedByOverlayId: null })
            .where(eq(overlays.replacedByOverlayId, input.id));
          await tx.delete(overlays).where(eq(overlays.id, input.id));
        });

        console.log(
          `Admin ${ctx.user.id} deleted overlay ${input.id} (status: ${overlay.status})${input.reason ? ` - Reason: ${input.reason}` : ""}`,
        );

        // Removing an approved map overlay shrinks the project's footprint, so re-derive its
        // boundary. Only approved map overlays ever counted toward it. Best-effort, post-commit.
        if (overlay.kind === "map" && overlay.status === "approved" && overlay.projectId) {
          await assignProjectBoundary(overlay.projectId);
        }

        try {
          await deleteImages(overlay.filename, "both");
        } catch (error) {
          console.error(`Failed to delete images for overlay ${input.id}:`, error);
        }

        return {
          success: true,
          deletedOverlayId: input.id,
          deletedFilename: overlay.filename,
        };
      } catch (error) {
        console.error("Error deleting overlay:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete overlay",
        });
      }
    }),
});

async function buildHiddenUserIdsSet(moderatorId: string): Promise<Set<string>> {
  // One grouped row per reported user instead of loading the whole user_reports table.
  // A user is hidden if this moderator reported them, or 3+ moderators reported them.
  const rows = await db
    .select({
      reportedUserId: userReports.reportedUserId,
      reportCount: sql<number>`count(*)::int`,
      reportedByMe: sql<boolean>`bool_or(${userReports.reportedBy} = ${moderatorId})`,
    })
    .from(userReports)
    .groupBy(userReports.reportedUserId);

  const hiddenUserIds = new Set<string>();
  for (const row of rows) {
    if (row.reportedByMe || row.reportCount >= 3) {
      hiddenUserIds.add(row.reportedUserId);
    }
  }

  return hiddenUserIds;
}

async function collectPendingProjectIds(): Promise<{
  pendingOverlayProjectIds: string[];
  pendingChangeProjectIds: string[];
}> {
  const [projectsWithPendingOverlays, projectsWithPendingChanges] = await Promise.all([
    db
      .selectDistinct({ projectId: overlays.projectId })
      .from(overlays)
      .where(eq(overlays.status, "pending")),
    db
      .selectDistinct({
        projectId: sql<string>`CASE
          WHEN ${changeRequests.entityType} = 'project' THEN ${changeRequests.entityId}
          WHEN ${changeRequests.entityType} = 'overlay' THEN ${overlays.projectId}
        END`.as("projectId"),
      })
      .from(changeRequests)
      .leftJoin(overlays, eq(changeRequests.entityId, overlays.id)).where(sql`CASE
        WHEN ${changeRequests.entityType} = 'project' THEN ${changeRequests.entityId} IS NOT NULL
        WHEN ${changeRequests.entityType} = 'overlay' THEN ${overlays.projectId} IS NOT NULL
      END`),
  ]);

  const pendingOverlayProjectIds = projectsWithPendingOverlays
    .map((p) => p.projectId)
    .filter((id) => id !== null);

  const pendingChangeProjectIds = projectsWithPendingChanges.map((p) => p.projectId);

  return { pendingOverlayProjectIds, pendingChangeProjectIds };
}

async function fetchModerationData(
  projectModerationConditions: (SQL | undefined)[],
  sortColumn: PgColumn,
  limit: number,
) {
  // Fetch projects first to scope change request queries to exact project IDs,
  // avoiding slow full-table scans via COALESCE country conditions on the join
  const projectsResult = await buildProjectModerationQuery(db)
    .where(and(...projectModerationConditions))
    .orderBy(sql`${sortColumn} DESC`, sql`${projects.id} DESC`)
    .limit(limit + 1);

  const projectIds = projectsResult.map((p) => p.id);

  if (projectIds.length === 0) {
    return { projectsResult, overlaysResult: [], overlayChanges: [], projectChanges: [] };
  }

  const [overlaysResult, overlayChanges, projectChanges] = await Promise.all([
    buildOverlayModerationQuery(db).where(and(...projectModerationConditions)),
    // Overlay change requests scoped to the fetched project IDs
    db
      .select({
        id: changeRequests.id,
        entityType: changeRequests.entityType,
        entityId: changeRequests.entityId,
        fieldName: changeRequests.fieldName,
        oldValue: changeRequests.oldValue,
        newValue: changeRequests.newValue,
        changeReason: changeRequests.changeReason,
        status: changeRequests.status,
        requestedBy: changeRequests.requestedBy,
        requestedByUsername: users.username,
        createdAt: changeRequests.createdAt,
      })
      .from(changeRequests)
      .leftJoin(overlays, eq(changeRequests.entityId, overlays.id))
      .leftJoin(users, eq(changeRequests.requestedBy, users.id))
      .where(
        and(
          eq(changeRequests.entityType, "overlay"),
          eq(changeRequests.status, "pending"),
          inArray(overlays.projectId, projectIds),
        ),
      ),

    db
      .select({
        id: changeRequests.id,
        entityType: changeRequests.entityType,
        entityId: changeRequests.entityId,
        fieldName: changeRequests.fieldName,
        oldValue: changeRequests.oldValue,
        newValue: changeRequests.newValue,
        changeReason: changeRequests.changeReason,
        status: changeRequests.status,
        requestedBy: changeRequests.requestedBy,
        requestedByUsername: users.username,
        createdAt: changeRequests.createdAt,
      })
      .from(changeRequests)
      .leftJoin(users, eq(changeRequests.requestedBy, users.id))
      .where(
        and(
          eq(changeRequests.entityType, "project"),
          eq(changeRequests.status, "pending"),
          inArray(changeRequests.entityId, projectIds),
        ),
      ),
  ]);

  return { projectsResult, overlaysResult, overlayChanges, projectChanges };
}

function filterContentByReportedUsers<
  T extends { ownerId?: string | null; authorId?: string | null; requestedBy?: string | null },
>(items: T[], hiddenUserIds: Set<string>, userIdField: keyof T): T[] {
  return items.filter((item) => {
    const userId = item[userIdField];
    if (typeof userId !== "string") return true;
    return !hiddenUserIds.has(userId);
  });
}

async function enrichWithReportCounts(
  filteredProjects: Awaited<ReturnType<ReturnType<typeof buildProjectModerationQuery>["execute"]>>,
  filteredOverlays: Awaited<ReturnType<ReturnType<typeof buildOverlayModerationQuery>["execute"]>>,
  filteredChangeRequests: {
    id: string;
    entityType: EntityType;
    entityId: string;
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
    changeReason: string | null;
    status: "pending" | "approved" | "rejected" | "conflicted";
    requestedBy: string | null;
    requestedByUsername: string | null;
    createdAt: Date;
    hasConflict: boolean;
  }[],
) {
  const userIds = new Set<string>();
  for (const project of filteredProjects) {
    if (project.ownerId) userIds.add(project.ownerId);
  }
  for (const overlay of filteredOverlays) {
    if (overlay.authorId) userIds.add(overlay.authorId);
  }
  for (const change of filteredChangeRequests) {
    if (change.requestedBy) userIds.add(change.requestedBy);
  }

  const reportCounts = await db
    .select({
      reportedUserId: userReports.reportedUserId,
      count: sql<string>`COUNT(*)`,
    })
    .from(userReports)
    .where(inArray(userReports.reportedUserId, [...userIds]))
    .groupBy(userReports.reportedUserId);

  const reportCountMap = new Map<string, number>();
  for (const row of reportCounts) {
    reportCountMap.set(row.reportedUserId, Number(row.count));
  }

  const projectsWithOverlays = filteredProjects.map((project) =>
    Object.assign(project, {
      ownerReportCount: project.ownerId ? (reportCountMap.get(project.ownerId) ?? 0) : 0,
      overlays: filteredOverlays.filter((overlay) => overlay.projectId === project.id),
    }),
  );

  const overlaysWithReports = filteredOverlays
    .filter((overlay) => overlay.status === "pending")
    .map((overlay) =>
      Object.assign(overlay, {
        authorReportCount: overlay.authorId ? (reportCountMap.get(overlay.authorId) ?? 0) : 0,
      }),
    );

  const changeRequestsWithReports = filteredChangeRequests.map((change) => {
    const requestedByReportCount = change.requestedBy
      ? (reportCountMap.get(change.requestedBy) ?? 0)
      : 0;
    return Object.assign(change, { requestedByReportCount });
  });

  return { projectsWithOverlays, overlaysWithReports, changeRequestsWithReports };
}

async function handleOverlayRejection(
  overlayId: string,
  expectedVersion: number,
  authorId: string | null,
  filename: string,
  rejectionReason?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
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
  } catch (error) {
    console.error("Error in handleOverlayRejection:", error);
    return { success: false, error: "Failed to process rejection" };
  }
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
  try {
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
  } catch (error) {
    console.error("Error in handleReplacementConflicts:", error);
    return {
      success: false,
      error: "Failed to handle replacement conflicts",
      competingReplacements: [],
    };
  }
}

async function handleOverlayApproval(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  overlayId: string,
  expectedVersion: number,
  authorId: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
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
  } catch (error) {
    console.error("Error in handleOverlayApproval:", error);
    return { success: false, error: "Failed to approve overlay" };
  }
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
