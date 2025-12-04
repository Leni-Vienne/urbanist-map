import { moderatorProcedure, router } from "../trpc";
import * as z from "zod"; // smaller bundle compared to 'import { z } from 'zod';
import {
  projects,
  overlays,
  approvalStatusEnum,
  changeRequests,
  cities,
  users,
  userReports,
} from "../db/schema";
import { eq, inArray, or, and, sql, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../database";
import {
  buildProjectModerationQuery,
  buildOverlayModerationQuery,
  buildPaginationConditions,
  buildPaginationResponse,
  addConflictFlags,
  enrichChangeRequestsWithNames,
} from "../db/helpers";
import {
  LocalFileStorage,
  R2StorageS3,
  getThumbnailFilename,
  streamToBuffer,
} from "../lib/storage";
import { scheduleImageCleanup, deleteImages, daysFromNow } from "../lib/imageCleanup";

// AI : Helper functions to update user moderation stats
// AI : These are called within transactions to ensure atomicity
// AI : Using Pick to accept both db and transaction objects
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

// AI : Helper function to migrate image and thumbnail from local storage to R2 on approval
// Two-phase thumbnail strategy to prevent abuse:
// 1. During upload: Thumbnail stays local (moderation UI only, served from backend's 1Gbit connection)
// 2. After approval: Thumbnail migrates to R2 (public display, prevents R2 cost abuse from spam uploads)
async function migrateImageToR2(filename: string): Promise<void> {
  const localStorage = new LocalFileStorage();
  const r2Storage = new R2StorageS3({
    endpoint: process.env.R2_ENDPOINT!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucketName: process.env.R2_BUCKET_NAME!,
  });

  // AI : Upload main image to R2
  const localFile = await localStorage.get(filename);
  if (!localFile) {
    throw new Error(`Local file not found: ${filename}`);
  }

  const buffer = await streamToBuffer(localFile.body);
  await r2Storage.put(filename, buffer.buffer as ArrayBuffer);

  // AI : Upload thumbnail to R2 (for public display after approval)
  // Thumbnails are stored in ./uploads/thumbnails/ locally
  const thumbnailFilename = getThumbnailFilename(filename);
  const thumbnailFile = await localStorage.get(thumbnailFilename);

  if (thumbnailFile) {
    const thumbnailBuffer = await streamToBuffer(thumbnailFile.body);
    // AI : On R2, store thumbnails in thumbnails/ prefix for organization
    // skipThumbnail prevents recursive thumbnail generation
    await r2Storage.put(thumbnailFilename, thumbnailBuffer.buffer as ArrayBuffer, {
      skipThumbnail: true,
    });
  } else {
    console.warn(`Thumbnail not found for ${filename}, skipping thumbnail upload`);
  }

  // AI : Delete local files after successful migration to R2 to save disk space
  try {
    await localStorage.delete(filename);

    if (thumbnailFile) {
      await localStorage.delete(thumbnailFilename);
    }
  } catch (error) {
    console.error(`Failed to delete local files for ${filename}:`, error);
    // AI : Don't throw - migration was successful, deletion is cleanup
  }
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
          cityId: z.string().uuid().optional(),
          countryCode: z.string().length(3).optional(),
        })
        .optional(),
    )
    .query(async ({ input = {}, ctx }) => {
      try {
        const sortColumn = input.sortBy === "updatedAt" ? projects.updatedAt : projects.createdAt;
        const limit = input.limit ?? 50;

        // AI : Country-scoped moderation - moderators can only see their assigned countries
        // AI : Admins (role='admin' or moderatedCountries=null) can see all countries
        const userModeratedCountries = ctx.user.moderatedCountries;
        const isAdmin = ctx.user.role === "admin";
        const moderatorId = ctx.user.id;

        // AI : Get users that should be hidden from this moderator
        // AI : Rules: reported by me = hidden for me, 3+ reports = hidden for all
        const allReports = await db
          .select({
            reportedUserId: userReports.reportedUserId,
            reportedBy: userReports.reportedBy,
          })
          .from(userReports);

        // AI : Build set of hidden user IDs based on report rules
        const reportCountByUser = new Map<string, number>();
        const myReportedUsers = new Set<string>();

        for (const report of allReports) {
          const count = reportCountByUser.get(report.reportedUserId) ?? 0;
          reportCountByUser.set(report.reportedUserId, count + 1);

          if (report.reportedBy === moderatorId) {
            myReportedUsers.add(report.reportedUserId);
          }
        }

        // AI : User is hidden if: reported by current moderator OR has 3+ reports total
        const hiddenUserIds = new Set<string>();
        for (const [userId, count] of reportCountByUser) {
          if (myReportedUsers.has(userId) || count >= 3) {
            hiddenUserIds.add(userId);
          }
        }

        let effectiveCountryCode = input.countryCode;

        if (!isAdmin && userModeratedCountries && userModeratedCountries.length > 0) {
          // AI : User is a moderator with assigned countries
          if (!input.countryCode) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Moderators must select a country to moderate",
            });
          }

          // AI : Verify moderator has permission for requested country
          if (!userModeratedCountries.includes(input.countryCode)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have permission to moderate this country",
            });
          }

          effectiveCountryCode = input.countryCode;
        }

        // AI : Step 1: Find all project IDs that need moderation (pending projects, pending overlays, pending changes)
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

        const projectIdsWithPendingOverlays = projectsWithPendingOverlays
          .map((p) => p.projectId)
          .filter((id): id is string => id !== null);

        const projectIdsWithPendingChanges = projectsWithPendingChanges
          .map((p) => p.projectId)
          .filter((id): id is string => id !== null);

        // AI : Step 2: Build filters for projects, overlays, and change requests
        const paginationConditions = await buildPaginationConditions(
          { cityId: input.cityId, countryCode: effectiveCountryCode, cursor: input.cursor },
          sortColumn,
        );

        // AI : Projects needing moderation: pending status OR have pending overlays OR have pending changes
        const projectModerationConditions = [
          or(
            eq(projects.status, "pending"),
            ...(projectIdsWithPendingOverlays.length > 0
              ? [inArray(projects.id, projectIdsWithPendingOverlays)]
              : []),
            ...(projectIdsWithPendingChanges.length > 0
              ? [inArray(projects.id, projectIdsWithPendingChanges)]
              : []),
          ),
          ...paginationConditions,
        ];

        // AI : Step 3: Fetch all moderation data in parallel
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
              requestedByUsername: users.username, // AI : Display friendly username in moderation UI
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
              requestedByUsername: users.username, // AI : Display friendly username in moderation UI
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

        // AI : Step 4: Combine and format results
        const changeRequestsResult = [...overlayChanges, ...projectChanges].toSorted(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );

        // AI : Add hasConflict flag to changes that have competing requests
        const changeRequestsWithConflictInfo = addConflictFlags(changeRequestsResult);

        const paginationResponse = buildPaginationResponse(projectsResult, limit);

        // AI : Filter out rejected and replaced overlays from moderation panel
        const visibleOverlays = overlaysResult.filter(
          (overlay) => overlay.status !== "rejected" && overlay.status !== "replaced",
        );

        // AI : Filter out content from hidden users (reported by moderator or 3+ reports)
        const filteredProjects = paginationResponse.items.filter(
          (project) => !project.ownerId || !hiddenUserIds.has(project.ownerId),
        );

        const filteredOverlays = visibleOverlays.filter(
          (overlay) => !overlay.authorId || !hiddenUserIds.has(overlay.authorId),
        );

        const filteredChangeRequests = changeRequestsWithConflictInfo.filter(
          (change) => !change.requestedBy || !hiddenUserIds.has(change.requestedBy),
        );

        // AI : Collect all user IDs to fetch report counts
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

        // AI : Enrich change requests with city and country names
        const enrichedChangeRequests = await enrichChangeRequestsWithNames(filteredChangeRequests);

        // AI : Add report counts to change requests
        const changeRequestsWithReports = enrichedChangeRequests.map((change) => {
          const requestedByReportCount = change.requestedBy
            ? (reportCountMap.get(change.requestedBy) ?? 0)
            : 0;
          return Object.assign(change, { requestedByReportCount });
        });

        return {
          projects: projectsWithOverlays,
          overlays: overlaysWithReports,
          changeRequests: changeRequestsWithReports,
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
            .set({ status: input.status })
            .where(
              and(
                eq(projects.id, input.id),
                eq(projects.version, input.expectedVersion),
                statusCondition,
              ),
            )
            .returning({ id: projects.id, version: projects.version, ownerId: projects.ownerId });

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
          }

          return { success: true as const };
        });

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
        handleReplacementConflicts: z.boolean().optional().default(false), // AI : Whether to auto-handle replacement conflicts
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

        // AI : Handle rejection first (simpler case)
        if (input.status === "rejected") {
          // AI : Use transaction to atomically update overlay and user stats
          const rejectionResult = await db.transaction(async (tx) => {
            // AI : Atomic update with version check
            const result = await tx
              .update(overlays)
              .set({ status: input.status, version: sql`${overlays.version} + 1` })
              .where(
                and(
                  eq(overlays.id, input.id),
                  eq(overlays.version, input.expectedVersion),
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
            // AI : For both regular and replacement overlays: delete full immediately, keep thumbnail for 15 days
            // AI : Thumbnails allow users to see what was rejected in ModeratedContributionsDialog
            // AI : Uses deleteImages helper to handle both production/R2 and development/local
            await deleteImages(overlayFilename, "full");
            await scheduleImageCleanup(input.id, overlayFilename, daysFromNow(15), "thumbnail");
          } catch (error) {
            console.error("Failed to cleanup rejected overlay images:", error);
            // AI : Don't fail the rejection if cleanup fails
          }

          return { success: true };
        }

        // AI : Handle approval (more complex, especially for replacements)
        const transactionResult = await db.transaction(async (tx) => {
          // AI : Track competing replacements for post-transaction cleanup
          let competingReplacements: {
            id: string;
            filename: string;
            authorId: string | null;
          }[] = [];

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

          // AI : If this is a replacement overlay, handle the replacement workflow
          if (replacesOverlayId && input.handleReplacementConflicts) {
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
              };
            }

            // AI : Mark original as 'replaced'
            await tx
              .update(overlays)
              .set({
                status: "replaced", // AI : Cast needed due to enum type
                replacedByOverlayId: input.id,
                version: sql`${overlays.version} + 1`,
              })
              .where(eq(overlays.id, replacesOverlayId));

            // AI : Mark all pending change requests as 'conflicted'
            await tx
              .update(changeRequests)
              .set({
                status: "conflicted",
                resolvedAt: new Date(),
                resolvedBy: ctx.user.id,
              })
              .where(
                and(
                  eq(changeRequests.entityType, "overlay"),
                  eq(changeRequests.entityId, replacesOverlayId),
                  eq(changeRequests.status, "pending"),
                ),
              );

            // AI : Find and reject competing replacement overlays
            competingReplacements = await tx
              .select({ id: overlays.id, filename: overlays.filename, authorId: overlays.authorId })
              .from(overlays)
              .where(
                and(
                  eq(overlays.replacesOverlayId, replacesOverlayId),
                  eq(overlays.status, "pending"),
                  ne(overlays.id, input.id),
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
                    competingReplacements.map((o) => o.id),
                  ),
                );

              // AI : Increment rejection count for each competing replacement author
              for (const competing of competingReplacements) {
                await incrementRejectedCount(tx, competing.authorId);
              }
            }
          }

          // AI : Approve the overlay
          const result = await tx
            .update(overlays)
            .set({
              status: "approved",
              version: sql`${overlays.version} + 1`,
            })
            .where(eq(overlays.id, input.id))
            .returning({ id: overlays.id });

          if (result.length === 0) {
            return { success: false, error: "Failed to approve overlay" };
          }

          // AI : Increment author's approval count
          await incrementApprovedCount(tx, authorId);

          return {
            success: true,
            competingReplacements: replacesOverlayId ? competingReplacements : [],
          };
        });

        // AI : Return early if transaction failed
        if (!transactionResult.success) {
          return transactionResult;
        }

        // AI : AFTER successful transaction, handle image cleanup for replacement workflow
        if (
          replacesOverlayId &&
          input.handleReplacementConflicts &&
          transactionResult.competingReplacements
        ) {
          // AI : Delete images for competing replacements
          for (const competing of transactionResult.competingReplacements) {
            try {
              // AI : Uses deleteImages helper to handle both production/R2 and development/local
              await deleteImages(competing.filename, "full");
              await scheduleImageCleanup(
                competing.id,
                competing.filename,
                daysFromNow(15),
                "thumbnail",
              );
            } catch (error) {
              console.error(`Failed to cleanup competing replacement ${competing.id}:`, error);
            }
          }

          // AI : Handle cleanup for replaced overlay images based on environment
          try {
            const originalOverlayData = await db
              .select({ filename: overlays.filename })
              .from(overlays)
              .where(eq(overlays.id, replacesOverlayId))
              .limit(1);

            if (originalOverlayData.length > 0) {
              // AI : Replaced overlays: delete full immediately, keep thumbnail for 15 days
              // AI : Same behavior as rejected overlays - consistent across prod and dev
              // AI : Uses deleteImages helper to handle both production/R2 and development/local
              await deleteImages(originalOverlayData[0].filename, "full");
              await scheduleImageCleanup(
                replacesOverlayId,
                originalOverlayData[0].filename,
                daysFromNow(15),
                "thumbnail",
              );
            }
          } catch (error) {
            console.error(`Failed to cleanup replaced overlay images:`, error);
          }
        }

        // AI : After transaction, migrate image to R2 (outside transaction for safety)
        if (
          input.status === "approved" &&
          overlayFilename &&
          process.env.NODE_ENV === "production"
        ) {
          try {
            await migrateImageToR2(overlayFilename);
          } catch (error) {
            console.error("Failed to migrate image to R2:", error);
            // AI : Don't fail the approval if R2 migration fails - image is still accessible in local storage
          }
        }

        // AI : Return the transaction result
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
});
