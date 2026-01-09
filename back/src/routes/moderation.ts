import { moderatorProcedure, adminProcedure, router } from "../trpc";
import {
  projects,
  overlays,
  approvalStatusEnum,
  changeRequests,
  cities,
  users,
  userReports,
} from "../db/schema";
import { and, eq, or, sql, inArray, ne, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, type Database } from "../database";
import {
  deleteImages,
  deleteLocalImages,
  scheduleImageCleanup,
  daysFromNow,
} from "../lib/imageCleanup";
import { TRPCError } from "@trpc/server";
import {
  buildProjectModerationQuery,
  buildOverlayModerationQuery,
  buildPaginationConditions,
  buildPaginationResponse,
  addConflictFlags,
  enrichChangeRequestsWithNames,
} from "../db/helpers";
import { incrementCityProjectCount, decrementCityProjectCount } from "../db/updateCityCounts";
import { queueR2Migration } from "../services/r2MigrationService";
import * as z from "zod";

// AI : Helper functions to update user moderation stats
// AI : These are called within transactions to ensure atomicity
// AI : Using Pick to accept both db and transaction objects
type DbOrTx = Pick<typeof db, "update">;

const THUMBNAIL_RETENTION_DAYS = 15;

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

// AI : Schema for legacy approval endpoints - supports arrays but frontend only sends single items
// Used only for undo functionality in the frontend
const setApprovalStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(approvalStatusEnum.enumValues),
});

// AI : Helper to check if moderator has permission for a project's country
// Returns the country code if permitted, throws FORBIDDEN if not
async function checkModeratorCountryPermission(
  projectId: string,
  user: { role: string | null; moderatedCountries: string[] | null },
): Promise<string> {
  // AI : Admins can moderate any country
  if (user.role === "admin" || user.moderatedCountries === null) {
    return "*"; // AI : Wildcard indicating all countries allowed
  }

  // AI : Get the project's country code via city join
  const projectCountry = await db
    .select({ countryCode: cities.countryCode })
    .from(projects)
    .innerJoin(cities, eq(projects.cityId, cities.id))
    .where(eq(projects.id, projectId))
    .limit(1);

  if (projectCountry.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  const countryCode = projectCountry[0].countryCode;

  // AI : Check if moderator has permission for this country
  if (!user.moderatedCountries.includes(countryCode)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to moderate content in this country",
    });
  }

  return countryCode;
}

// AI : Helper to check moderator permission for an overlay via its project
async function checkModeratorOverlayPermission(
  overlayId: string,
  user: { role: string | null; moderatedCountries: string[] | null },
): Promise<string> {
  // AI : Admins can moderate any country
  if (user.role === "admin" || user.moderatedCountries === null) {
    return "*";
  }

  // AI : Get the overlay's country code via project -> city join
  const overlayCountry = await db
    .select({ countryCode: cities.countryCode })
    .from(overlays)
    .innerJoin(projects, eq(overlays.projectId, projects.id))
    .innerJoin(cities, eq(projects.cityId, cities.id))
    .where(eq(overlays.id, overlayId))
    .limit(1);

  if (overlayCountry.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
  }

  const countryCode = overlayCountry[0].countryCode;

  if (!user.moderatedCountries.includes(countryCode)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to moderate content in this country",
    });
  }

  return countryCode;
}

// AI : Schema for version-aware approval to prevent race conditions
// Supports arrays but frontend only sends single items for individual approval/rejection
const setApprovalStatusWithVersionSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int(),
  status: z.enum(approvalStatusEnum.enumValues),
  rejectionReason: z.string().max(500).optional(), // AI : Moderator-selected rejection reason
  rejectAllOverlays: z.boolean().optional(), // AI : Whether to also reject all pending overlays when rejecting a project
});

export const moderationRouter = router({
  // AI : Check for conflicts when approving a replacement overlay
  checkReplacementConflicts: moderatorProcedure
    .input(z.object({ overlayId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      try {
        // AI : Verify moderator has permission for this overlay's country
        await checkModeratorOverlayPermission(input.overlayId, ctx.user);
        // AI : Get the overlay being approved
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

        if (overlay.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
        }

        const replacesOverlayId = overlay[0].replacesOverlayId;

        // AI : If not a replacement, no conflicts to check
        if (!replacesOverlayId) {
          return {
            isReplacement: false,
            pendingChangeRequests: [],
            competingReplacements: [],
          };
        }

        // AI : Get the original overlay being replaced
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

        if (originalOverlay.length === 0 || originalOverlay[0].status !== "approved") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot replace overlay that is not approved",
          });
        }

        // AI : Find pending change requests on the original overlay
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

        // AI : Find competing replacement overlays (other pending overlays trying to replace the same original)
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
          originalOverlayCaption: originalOverlay[0].caption,
          originalOverlayFilename: originalOverlay[0].filename,
          newOverlayFilename: overlay[0].filename,
          newOverlayCaption: overlay[0].caption,
          pendingChangeRequests: pendingChanges,
          competingReplacements: competingReplacements,
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
          cityId: z.number().optional(),
          countryCode: z.string().length(3).optional(),
        })
        .optional(),
    )
    .query(async ({ input = {}, ctx }) => {
      try {
        const sortColumn = input.sortBy === "updatedAt" ? projects.updatedAt : projects.createdAt;
        const limit = input.limit ?? 50;

        // AI : Country-scoped moderation - moderators can only see their assigned countries
        const userModeratedCountries = ctx.user.moderatedCountries;
        const isAdmin = ctx.user.role === "admin";
        const moderatorId = ctx.user.id;

        // AI : Early permission check - validate country access before any DB queries
        let effectiveCountryCode = input.countryCode;

        if (!isAdmin && userModeratedCountries && userModeratedCountries.length > 0) {
          if (!input.countryCode) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Moderators must select a country to moderate",
            });
          }

          if (!userModeratedCountries.includes(input.countryCode)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have permission to moderate this country",
            });
          }

          effectiveCountryCode = input.countryCode;
        }

        // AI : Step 1: Get hidden users and pending project IDs
        const [hiddenUserIds, pendingProjectIds] = await Promise.all([
          buildHiddenUserIdsSet(moderatorId),
          collectPendingProjectIds(),
        ]);

        // AI : Step 2: Build pagination and moderation conditions
        const paginationConditions = await buildPaginationConditions(
          { cityId: input.cityId, countryCode: effectiveCountryCode, cursor: input.cursor },
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

        // AI : Step 3: Fetch all moderation data
        const { projectsResult, overlaysResult, overlayChanges, projectChanges } =
          await fetchModerationData(
            projectModerationConditions,
            paginationConditions,
            sortColumn,
            limit,
          );

        // AI : Step 4: Process and filter results
        const changeRequestsResult = [...overlayChanges, ...projectChanges].toSorted(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );

        const changeRequestsWithConflictInfo = addConflictFlags(changeRequestsResult);
        const paginationResponse = buildPaginationResponse(projectsResult, limit);

        // AI : Filter out rejected and replaced overlays
        const visibleOverlays = overlaysResult.filter(
          (overlay) => overlay.status !== "rejected" && overlay.status !== "replaced",
        );

        // AI : Filter by reported users
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

        // AI : Step 5: Enrich with report counts
        const { projectsWithOverlays, overlaysWithReports, changeRequestsWithReports } =
          await enrichWithReportCounts(filteredProjects, filteredOverlays, filteredChangeRequests);

        // AI : Enrich change requests with city and country names
        const enrichedChangeRequests =
          await enrichChangeRequestsWithNames(changeRequestsWithReports);

        return {
          projects: projectsWithOverlays,
          overlays: overlaysWithReports,
          changeRequests: enrichedChangeRequests,
          pagination: paginationResponse.pagination,
        };
      } catch (error) {
        console.error("Error fetching pending submissions:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch pending submissions",
        });
      }
    }),

  // AI : Get pending item counts per country for moderation dashboard
  // AI : Returns total pending count (projects + overlays + change requests) for each country
  // AI : Respects moderator country permissions (only shows counts for assigned countries)
  getPendingCountsByCountry: moderatorProcedure.query(async ({ ctx }) => {
    try {
      const userModeratedCountries = ctx.user.moderatedCountries;
      const isAdmin = ctx.user.role === "admin";

      // AI : Build country filter based on moderator permissions
      let countryFilter: SQL | undefined = undefined;
      if (!isAdmin && userModeratedCountries && userModeratedCountries.length > 0) {
        countryFilter = inArray(cities.countryCode, userModeratedCountries);
      }

      // AI : Efficient single-query approach using CASE statements for conditional counting
      // AI : This prevents N+1 queries and uses database indexes optimally
      const result = await db
        .select({
          countryCode: cities.countryCode,
          // AI : Count distinct pending projects
          pendingProjects: sql<number>`COUNT(DISTINCT CASE WHEN ${projects.status} = 'pending' THEN ${projects.id} END)`,
          // AI : Count distinct pending overlays
          pendingOverlays: sql<number>`COUNT(DISTINCT CASE WHEN ${overlays.status} = 'pending' THEN ${overlays.id} END)`,
          // AI : Count distinct pending change requests (for both project and overlay changes)
          pendingChanges: sql<number>`COUNT(DISTINCT CASE WHEN ${changeRequests.status} = 'pending' THEN ${changeRequests.id} END)`,
        })
        .from(cities)
        .leftJoin(projects, eq(projects.cityId, cities.id))
        .leftJoin(overlays, eq(overlays.projectId, projects.id))
        .leftJoin(
          changeRequests,
          or(
            and(eq(changeRequests.entityType, "project"), eq(changeRequests.entityId, projects.id)),
            and(eq(changeRequests.entityType, "overlay"), eq(changeRequests.entityId, overlays.id)),
          ),
        )
        .where(countryFilter)
        .groupBy(cities.countryCode);

      // AI : Calculate total pending items per country and filter out countries with zero counts
      const countsWithTotals = result
        .map((row) => ({
          countryCode: row.countryCode,
          total:
            Number(row.pendingProjects) + Number(row.pendingOverlays) + Number(row.pendingChanges),
        }))
        .filter((row) => row.total > 0); // AI : Only return countries with pending items

      return countsWithTotals;
    } catch (error) {
      console.error("Error fetching pending counts by country:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch pending counts",
      });
    }
  }),

  // AI : Undo project approval - restores project to previous status (typically pending)
  // Frontend always sends single ID wrapped in array: ids: [singleId]
  undoProjectApprovalStatus: moderatorProcedure
    .input(setApprovalStatusSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        // AI : Verify moderator has permission for this project's country
        await checkModeratorCountryPermission(input.id, ctx.user);

        // AI : Use transaction to atomically update project and decrement user stats
        await db.transaction(async (tx) => {
          // AI : Get current status and ownerId before updating
          const currentProject = await tx
            .select({ status: projects.status, ownerId: projects.ownerId })
            .from(projects)
            .where(eq(projects.id, input.id))
            .limit(1);

          if (currentProject.length === 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
          }

          const previousStatus = currentProject[0].status;
          const ownerId = currentProject[0].ownerId;

          // AI : Update project status
          await tx.update(projects).set({ status: input.status }).where(eq(projects.id, input.id));

          // AI : Decrement the appropriate counter based on previous status
          if (previousStatus === "approved") {
            await decrementApprovedCount(tx, ownerId);
          } else if (previousStatus === "rejected") {
            await decrementRejectedCount(tx, ownerId);
          }
        });

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

  // AI : Undo overlay approval - restores overlay to previous status (typically pending)
  // Frontend always sends single ID wrapped in array: ids: [singleId]
  undoOverlayApprovalStatus: moderatorProcedure
    .input(setApprovalStatusSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        // AI : Verify moderator has permission for this overlay's country
        await checkModeratorOverlayPermission(input.id, ctx.user);

        // AI : Use transaction to atomically update overlay and decrement user stats
        await db.transaction(async (tx) => {
          // AI : Get current status and authorId before updating
          const currentOverlay = await tx
            .select({ status: overlays.status, authorId: overlays.authorId })
            .from(overlays)
            .where(eq(overlays.id, input.id))
            .limit(1);

          if (currentOverlay.length === 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
          }

          const previousStatus = currentOverlay[0].status;
          const authorId = currentOverlay[0].authorId;

          // AI : Update overlay status
          await tx.update(overlays).set({ status: input.status }).where(eq(overlays.id, input.id));

          // AI : Decrement the appropriate counter based on previous status
          if (previousStatus === "approved") {
            await decrementApprovedCount(tx, authorId);
          } else if (previousStatus === "rejected") {
            await decrementRejectedCount(tx, authorId);
          }
        });

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

  // AI : Version-aware project approval to prevent race conditions
  // Frontend always sends single item wrapped in array: items: [{ id, expectedVersion }]
  setProjectApprovalStatusWithVersion: moderatorProcedure
    .input(setApprovalStatusWithVersionSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        // AI : Verify moderator has permission for this project's country
        await checkModeratorCountryPermission(input.id, ctx.user);

        // AI : Allow updating pending projects (any action) OR approved projects
        const statusCondition =
          input.status === "rejected"
            ? or(eq(projects.status, "pending"), eq(projects.status, "approved"))
            : eq(projects.status, "pending");

        // AI : Use transaction to atomically update project and user stats
        const result = await db.transaction(async (tx) => {
          // AI : Atomic update with version check and status check in WHERE clause
          const updateResult = await tx
            .update(projects)
            .set({
              status: input.status,
              // AI : Save rejection reason when rejecting, clear it when approving
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
              cityId: projects.cityId,
            });

          if (updateResult.length === 0) {
            // AI : Either project doesn't exist, version mismatch, or status not allowed
            const currentProject = await tx
              .select({ version: projects.version, status: projects.status })
              .from(projects)
              .where(eq(projects.id, input.id))
              .limit(1);

            if (currentProject.length === 0) {
              return { success: false, error: "Project not found" };
            } else if (
              currentProject[0].status !== "pending" &&
              !(input.status === "rejected" && currentProject[0].status === "approved")
            ) {
              return {
                success: false,
                error: "Project already processed",
                currentStatus: currentProject[0].status,
              };
            } else {
              return {
                success: false,
                error: "Version mismatch",
                expectedVersion: input.expectedVersion,
                currentVersion: currentProject[0].version,
              };
            }
          }

          // AI : Increment user's approval/rejection count
          const ownerId = updateResult[0].ownerId;
          if (input.status === "approved") {
            await incrementApprovedCount(tx, ownerId);
          } else if (input.status === "rejected") {
            await incrementRejectedCount(tx, ownerId);

            // AI : Optionally cascade rejection to all pending overlays
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
                // AI : Reject all pending overlays
                await tx
                  .update(overlays)
                  .set({ status: "rejected", rejectionReason: input.rejectionReason ?? null })
                  .where(and(eq(overlays.projectId, input.id), eq(overlays.status, "pending")));

                // AI : Increment rejection counts for overlay authors
                for (const overlay of pendingOverlays) {
                  await incrementRejectedCount(tx, overlay.authorId);
                }

                rejectedOverlayFilenames = pendingOverlays.map((o) => o.filename);
              }
            }

            return {
              success: true as const,
              cityId: updateResult[0].cityId,
              rejectedOverlayFilenames,
            };
          }

          return { success: true as const, cityId: updateResult[0].cityId };
        });

        // AI : Update city project count after transaction succeeds
        // AI : This is done outside transaction for performance - counts are eventually consistent
        if (result.success && result.cityId) {
          try {
            if (input.status === "approved") {
              await incrementCityProjectCount(result.cityId);
            } else if (input.status === "rejected") {
              // AI : Decrement count (already rejected in transaction above)
              await decrementCityProjectCount(result.cityId);
            }
          } catch (error) {
            console.error("Error updating city project count:", error);
            // AI : Don't fail the request if count update fails
          }
        }

        // AI : Clean up rejected overlay images if cascade rejection was used
        if (
          result.success &&
          result.rejectedOverlayFilenames &&
          result.rejectedOverlayFilenames.length > 0
        ) {
          for (const filename of result.rejectedOverlayFilenames) {
            try {
              await deleteLocalImages(filename, "full");
              await scheduleImageCleanup(
                input.id, // Use project ID as identifier
                filename,
                daysFromNow(THUMBNAIL_RETENTION_DAYS),
                "thumbnail",
              );
            } catch (error) {
              console.error(`Failed to cleanup rejected overlay: ${filename}`, error);
              // AI : Don't fail the request if cleanup fails
            }
          }
        }

        return result;
      } catch (error) {
        console.error("Error updating project status with version:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update project status",
        });
      }
    }),

  // AI : Version-aware overlay approval to prevent race conditions
  // Frontend always sends single item wrapped in array: items: [{ id, expectedVersion }]
  setOverlayApprovalStatusWithVersion: moderatorProcedure
    .input(
      setApprovalStatusWithVersionSchema.extend({
        handleReplacementConflicts: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // AI : Verify moderator has permission for this overlay's country
        await checkModeratorOverlayPermission(input.id, ctx.user);

        // AI : Get overlay data for processing
        const overlayData = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            replacesOverlayId: overlays.replacesOverlayId,
            status: overlays.status,
            version: overlays.version,
            authorId: overlays.authorId,
          })
          .from(overlays)
          .where(eq(overlays.id, input.id))
          .limit(1);

        if (overlayData.length === 0) {
          return { success: false, error: "Overlay not found" };
        }

        const overlay = overlayData[0];
        const overlayFilename = overlay.filename;
        const replacesOverlayId = overlay.replacesOverlayId;
        const authorId = overlay.authorId;

        // AI : Handle rejection
        if (input.status === "rejected") {
          return await handleOverlayRejection(
            input.id,
            input.expectedVersion,
            authorId,
            overlayFilename,
            input.rejectionReason, // AI : Pass rejection reason from input
          );
        }

        // AI : Handle approval (more complex, especially for replacements)
        const transactionResult = await db.transaction(async (tx) => {
          // AI : Lock and verify the overlay hasn't changed
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

          if (currentOverlay.length === 0) {
            return { success: false, error: "Overlay not found" };
          }

          // AI : Version and status checks
          if (currentOverlay[0].version !== input.expectedVersion) {
            return {
              success: false,
              error: "Version mismatch",
              expectedVersion: input.expectedVersion,
              currentVersion: currentOverlay[0].version,
            };
          }

          if (currentOverlay[0].status !== "pending") {
            return {
              success: false,
              error: "Overlay already processed",
              currentStatus: currentOverlay[0].status,
            };
          }

          // AI : Handle replacement conflicts if needed
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

          // AI : Approve the overlay
          const approvalResult = await handleOverlayApproval(tx, input.id, authorId);

          if (!approvalResult.success) {
            return { success: false, error: approvalResult.error };
          }

          return {
            success: true,
            competingReplacements: replacesOverlayId ? competingReplacements : [],
          };
        });

        // AI : Return early if transaction failed
        if (!transactionResult.success) {
          return transactionResult;
        }

        // AI : Handle image cleanup for replacement workflow
        if (
          replacesOverlayId &&
          input.handleReplacementConflicts &&
          transactionResult.competingReplacements
        ) {
          await cleanupReplacementImages(
            transactionResult.competingReplacements,
            replacesOverlayId,
          );
        }

        // AI : Queue R2 migration in production (non-blocking for instant response)
        if (
          input.status === "approved" &&
          overlayFilename &&
          process.env.NODE_ENV === "production"
        ) {
          queueR2Migration(overlayFilename);
        }

        return transactionResult;
      } catch (error) {
        console.error("Error updating overlay status with version:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update overlay status",
        });
      }
    }),

  // AI : Report a user for spam/harmful content
  // AI : Rules: 1 report = hide for that moderator, 2+ reports = warning for all, 3+ or admin = global hide
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

        // AI : Check if already reported by this moderator
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

        // AI : Create the report
        await db.insert(userReports).values({
          reportedUserId: input.userId,
          reportedBy: moderatorId,
          reason: input.reason,
        });

        // AI : Get total report count for this user
        const reportCount = await db
          .select({ count: sql<number>`COUNT(*)` })
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

  // AI : Remove a report for a user (if moderator changes their mind)
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

  // AI : Get list of users reported by the current moderator
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

  // AI : Get report counts for users (for displaying warning badges in moderation UI)
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

        // AI : Get report counts for each user
        const reportCounts = await db
          .select({
            reportedUserId: userReports.reportedUserId,
            count: sql<number>`COUNT(*)`,
          })
          .from(userReports)
          .where(inArray(userReports.reportedUserId, input.userIds))
          .groupBy(userReports.reportedUserId);

        // AI : Check which users are reported by the current moderator
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

        // AI : Build result map with visibility rules
        const result: Record<
          string,
          {
            totalReports: number;
            reportedByMe: boolean;
            isHidden: boolean; // AI : Whether this user's content should be hidden for the current moderator
          }
        > = {};

        for (const userId of input.userIds) {
          const count = reportCounts.find((report) => report.reportedUserId === userId);
          const totalReports = Number(count?.count ?? 0);
          const reportedByMe = myReportedUserIds.has(userId);

          // AI : Visibility rules:
          // - 1 report by me = hidden for me
          // - 3+ reports total OR admin report = hidden for all (handled in getPendingSubmissions)
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

  // AI : Get reported users for admin review
  // AI : Returns users with 2+ reports (threshold from config)
  getReportedUsers: adminProcedure.query(async () => {
    try {
      // AI : Get report threshold from config
      const configResult = await db
        .select({ reportThreshold: sql<number>`coalesce(report_threshold, 2)` })
        .from(sql`config`)
        .limit(1);

      const threshold = configResult[0]?.reportThreshold ?? 2;

      // AI : Get users with report counts >= threshold
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

      // AI : For each reported user, get detailed report info and content counts
      const enrichedUsers = await Promise.all(
        reportedUsers.map(async (user) => {
          // AI : Get reporter details and reasons
          const reports = await db
            .select({
              reporterId: userReports.reportedBy,
              reporterUsername: users.username,
              reporterEmail: users.email,
              reason: userReports.reason,
              createdAt: userReports.createdAt,
            })
            .from(userReports)
            .leftJoin(users, eq(userReports.reportedBy, users.id))
            .where(eq(userReports.reportedUserId, user.userId));

          // AI : Get pending and rejected content counts
          const [projectCounts, overlayCounts] = await Promise.all([
            db
              .select({
                pending: sql<number>`count(case when status = 'pending' then 1 end)::int`,
                rejected: sql<number>`count(case when status = 'rejected' then 1 end)::int`,
              })
              .from(projects)
              .where(eq(projects.ownerId, user.userId)),
            db
              .select({
                pending: sql<number>`count(case when status = 'pending' then 1 end)::int`,
                rejected: sql<number>`count(case when status = 'rejected' then 1 end)::int`,
              })
              .from(overlays)
              .where(eq(overlays.authorId, user.userId)),
          ]);

          return {
            userId: user.userId,
            email: user.email,
            username: user.username,
            banned: user.banned,
            bannedAt: user.bannedAt,
            banReason: user.banReason,
            reportCount: user.reportCount,
            reports,
            pendingProjects: projectCounts[0]?.pending ?? 0,
            rejectedProjects: projectCounts[0]?.rejected ?? 0,
            pendingOverlays: overlayCounts[0]?.pending ?? 0,
            rejectedOverlays: overlayCounts[0]?.rejected ?? 0,
          };
        }),
      );

      return enrichedUsers;
    } catch (error) {
      console.error("Error fetching reported users:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch reported users",
      });
    }
  }),

  // AI : Clear all reports for a user (unblock them)
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

  // AI : Ban user and optionally delete all their content
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
          // AI : Mark user as banned
          await tx
            .update(users)
            .set({
              banned: true,
              bannedAt: new Date(),
              bannedBy: ctx.user.id,
              banReason: input.reason,
            })
            .where(eq(users.id, input.userId));

          // AI : Delete content if requested
          if (input.deleteContent) {
            // AI : Get all pending and rejected overlay filenames for cleanup
            const overlaysToDelete = await tx
              .select({ filename: overlays.filename })
              .from(overlays)
              .where(
                and(
                  eq(overlays.authorId, input.userId),
                  or(eq(overlays.status, "pending"), eq(overlays.status, "rejected")),
                ),
              );

            // AI : Delete pending and rejected projects
            await tx
              .delete(projects)
              .where(
                and(
                  eq(projects.ownerId, input.userId),
                  or(eq(projects.status, "pending"), eq(projects.status, "rejected")),
                ),
              );

            // AI : Delete pending and rejected overlays
            await tx
              .delete(overlays)
              .where(
                and(
                  eq(overlays.authorId, input.userId),
                  or(eq(overlays.status, "pending"), eq(overlays.status, "rejected")),
                ),
              );

            // AI : Clean up images after transaction commits
            // AI : This is done outside transaction to avoid holding lock during I/O
            // AI : If cleanup fails, images are orphaned but database is consistent
            for (const overlay of overlaysToDelete) {
              try {
                await deleteLocalImages(overlay.filename, "both");
              } catch (error) {
                console.error(`Failed to delete images for ${overlay.filename}:`, error);
                // AI : Continue with other deletions
              }
            }
          }

          // AI : Clear all reports (no longer needed after ban)
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

  // AI : Admin-only endpoint to permanently delete an overlay (including approved ones)
  // AI : This removes the database record AND cleans up images from R2/local storage
  adminDeleteOverlay: adminProcedure
    .input(
      z.object({
        id: z.uuid(),
        reason: z.string().max(500).optional(), // AI : Optional reason for audit purposes
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // AI : Get overlay data before deletion for cleanup
        const overlayData = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            status: overlays.status,
            authorId: overlays.authorId,
            projectId: overlays.projectId,
          })
          .from(overlays)
          .where(eq(overlays.id, input.id))
          .limit(1);

        if (overlayData.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
        }

        const overlay = overlayData[0];

        // AI : Delete overlay from database
        await db.delete(overlays).where(eq(overlays.id, input.id));

        // AI : Log deletion for audit trail
        console.log(
          `Admin ${ctx.user.id} deleted overlay ${input.id} (status: ${overlay.status})${input.reason ? ` - Reason: ${input.reason}` : ""}`,
        );

        // AI : Clean up images
        // AI : Approved overlays have images in R2, pending/rejected in local storage
        // AI : The deleteImages function handles both based on environment
        try {
          await deleteImages(overlay.filename, "both");
          console.log(`Deleted images for overlay ${input.id}: ${overlay.filename}`);
        } catch (imageError) {
          console.error(`Failed to delete images for overlay ${input.id}:`, imageError);
          // AI : Don't fail the request if image cleanup fails - database is already updated
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

// AI : Helper functions for getPendingSubmissions refactoring

// AI : Build set of user IDs that should be hidden from the moderator
// Rules: reported by me = hidden for me, 3+ reports = hidden for all
async function buildHiddenUserIdsSet(moderatorId: string): Promise<Set<string>> {
  const allReports = await db
    .select({
      reportedUserId: userReports.reportedUserId,
      reportedBy: userReports.reportedBy,
    })
    .from(userReports);

  const reportCountByUser = new Map<string, number>();
  const myReportedUsers = new Set<string>();

  for (const report of allReports) {
    const count = reportCountByUser.get(report.reportedUserId) ?? 0;
    reportCountByUser.set(report.reportedUserId, count + 1);

    if (report.reportedBy === moderatorId) {
      myReportedUsers.add(report.reportedUserId);
    }
  }

  const hiddenUserIds = new Set<string>();
  for (const [userId, count] of reportCountByUser) {
    if (myReportedUsers.has(userId) || count >= 3) {
      hiddenUserIds.add(userId);
    }
  }

  return hiddenUserIds;
}

// AI : Collect all project IDs that need moderation
async function collectPendingProjectIds(): Promise<{
  pendingOverlayProjectIds: string[];
  pendingChangeProjectIds: string[];
}> {
  const [projectsWithPendingOverlays, projectsWithPendingChanges] = await Promise.all([
    // AI : Projects with pending overlay submissions
    db
      .selectDistinct({ projectId: overlays.projectId })
      .from(overlays)
      .where(eq(overlays.status, "pending")),

    // AI : Projects with pending change requests (on project or overlay)
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
    .filter((id): id is string => id !== null);

  const pendingChangeProjectIds = projectsWithPendingChanges
    .map((p) => p.projectId)
    .filter((id): id is string => id !== null);

  return { pendingOverlayProjectIds, pendingChangeProjectIds };
}

// AI : Fetch all moderation data in parallel
async function fetchModerationData(
  projectModerationConditions: (SQL | undefined)[],
  paginationConditions: (SQL | undefined)[],
  sortColumn: PgColumn,
  limit: number,
) {
  const [projectsResult, overlaysResult, overlayChanges, projectChanges] = await Promise.all([
    // AI : Projects with pagination
    buildProjectModerationQuery(db)
      .where(and(...projectModerationConditions))
      .orderBy(sortColumn)
      .limit(limit + 1),

    // AI : All overlays from moderation projects (to show in project accordions)
    buildOverlayModerationQuery(db).where(and(...projectModerationConditions)),

    // AI : Overlay change requests with city/country filters
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
      .leftJoin(projects, eq(overlays.projectId, projects.id))
      .leftJoin(cities, eq(projects.cityId, cities.id))
      .leftJoin(users, eq(changeRequests.requestedBy, users.id))
      .where(
        and(
          eq(changeRequests.entityType, "overlay"),
          eq(changeRequests.status, "pending"),
          ...paginationConditions,
        ),
      ),

    // AI : Project change requests with city/country filters
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
      .leftJoin(projects, eq(changeRequests.entityId, projects.id))
      .leftJoin(cities, eq(projects.cityId, cities.id))
      .leftJoin(users, eq(changeRequests.requestedBy, users.id))
      .where(
        and(
          eq(changeRequests.entityType, "project"),
          eq(changeRequests.status, "pending"),
          ...paginationConditions,
        ),
      ),
  ]);

  return { projectsResult, overlaysResult, overlayChanges, projectChanges };
}

// AI : Filter content by reported users
function filterContentByReportedUsers<
  T extends { ownerId?: string | null; authorId?: string | null; requestedBy?: string | null },
>(items: T[], hiddenUserIds: Set<string>, userIdField: keyof T): T[] {
  return items.filter((item) => {
    const userId = item[userIdField];
    return !userId || !hiddenUserIds.has(userId as string);
  });
}

// AI : Enrich entities with report counts
// AI : Proper types inferred from query builder return types
async function enrichWithReportCounts(
  filteredProjects: Awaited<ReturnType<ReturnType<typeof buildProjectModerationQuery>["execute"]>>,
  filteredOverlays: Awaited<ReturnType<ReturnType<typeof buildOverlayModerationQuery>["execute"]>>,
  filteredChangeRequests: {
    id: string;
    entityType: string;
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
  // AI : Collect all user IDs
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

  // AI : Fetch report counts for all users
  const reportCounts = await db
    .select({
      reportedUserId: userReports.reportedUserId,
      count: sql<number>`COUNT(*)`,
    })
    .from(userReports)
    .where(inArray(userReports.reportedUserId, [...userIds]))
    .groupBy(userReports.reportedUserId);

  // AI : Build map of user ID to report count
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

// AI : Helper functions for setOverlayApprovalStatusWithVersion refactoring

// AI : Handle overlay rejection workflow
async function handleOverlayRejection(
  overlayId: string,
  expectedVersion: number,
  authorId: string | null,
  filename: string,
  rejectionReason?: string, // AI : Optional rejection reason from moderator
): Promise<{ success: boolean; error?: string }> {
  try {
    // AI : Use transaction to atomically update overlay and user stats
    const rejectionResult = await db.transaction(async (tx) => {
      // AI : Atomic update with version check
      const result = await tx
        .update(overlays)
        .set({
          status: "rejected",
          version: sql`${overlays.version} + 1`,
          rejectionReason: rejectionReason ?? null, // AI : Save rejection reason
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

      // AI : Increment author's rejection count
      await incrementRejectedCount(tx, authorId);

      return { success: true as const };
    });

    if (!rejectionResult.success) {
      return rejectionResult;
    }

    // AI : Delete images for rejected overlays (outside transaction)
    try {
      // AI : For rejected overlays: delete full immediately, keep thumbnail for THUMBNAIL_RETENTION_DAYS
      // AI : Uses deleteLocalImages since pending overlays are always stored locally (not in R2)
      await deleteLocalImages(filename, "full");
      await scheduleImageCleanup(
        overlayId,
        filename,
        daysFromNow(THUMBNAIL_RETENTION_DAYS),
        "thumbnail",
      );
    } catch (error) {
      console.error("Failed to cleanup rejected overlay images:", error);
      // AI : Don't fail the rejection if cleanup fails
    }

    return { success: true };
  } catch (error) {
    console.error("Error in handleOverlayRejection:", error);
    return { success: false, error: "Failed to process rejection" };
  }
}

// AI : Handle replacement conflict resolution
// AI : Transaction type: Parameters<Parameters<Database['transaction']>[0]>[0]
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
    // AI : Lock the original overlay
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

    if (originalOverlay.length === 0 || originalOverlay[0].status !== "approved") {
      return {
        success: false,
        error: "Original overlay not found or not approved",
        competingReplacements: [],
      };
    }

    // AI : Mark original as 'replaced'
    await tx
      .update(overlays)
      .set({
        status: "replaced",
        replacedByOverlayId: newOverlayId,
        version: sql`${overlays.version} + 1`,
      })
      .where(eq(overlays.id, replacesOverlayId));

    // AI : Mark all pending change requests as 'conflicted'
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

    // AI : Find and reject competing replacement overlays
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

      // AI : Increment rejection count for each competing replacement author
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

// AI : Handle overlay approval
// AI : Transaction type: Parameters<Parameters<Database['transaction']>[0]>[0]
async function handleOverlayApproval(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  overlayId: string,
  authorId: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    // AI : Approve the overlay
    const result = await tx
      .update(overlays)
      .set({
        status: "approved",
        version: sql`${overlays.version} + 1`,
        // AI : Clear replacesOverlayId - once approved, it's no longer a "replacement"
        replacesOverlayId: null,
      })
      .where(eq(overlays.id, overlayId))
      .returning({ id: overlays.id });

    if (result.length === 0) {
      return { success: false, error: "Failed to approve overlay" };
    }

    // AI : Increment author's approval count
    await incrementApprovedCount(tx, authorId);

    return { success: true };
  } catch (error) {
    console.error("Error in handleOverlayApproval:", error);
    return { success: false, error: "Failed to approve overlay" };
  }
}

// AI : Cleanup images for replaced overlays and competing replacements
async function cleanupReplacementImages(
  competingReplacements: { id: string; filename: string }[],
  replacesOverlayId: string,
): Promise<void> {
  try {
    // AI : Delete images for competing replacements (pending overlays = local storage)
    for (const competing of competingReplacements) {
      try {
        await deleteLocalImages(competing.filename, "full");
        await scheduleImageCleanup(
          competing.id,
          competing.filename,
          daysFromNow(THUMBNAIL_RETENTION_DAYS),
          "thumbnail",
        );
      } catch (error) {
        console.error(`Failed to cleanup competing replacement ${competing.id}:`, error);
      }
    }

    // AI : Handle cleanup for replaced overlay images
    const originalOverlayData = await db
      .select({ filename: overlays.filename })
      .from(overlays)
      .where(eq(overlays.id, replacesOverlayId))
      .limit(1);

    if (originalOverlayData.length > 0) {
      await deleteImages(originalOverlayData[0].filename, "full");
      await scheduleImageCleanup(
        replacesOverlayId,
        originalOverlayData[0].filename,
        daysFromNow(THUMBNAIL_RETENTION_DAYS),
        "thumbnail",
      );
    }
  } catch (error) {
    console.error("Failed to cleanup replacement images:", error);
    // AI : Non-throwing - just log errors
  }
}
