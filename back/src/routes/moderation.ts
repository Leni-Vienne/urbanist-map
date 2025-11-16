import { adminProcedure, router } from '../trpc';
import * as z from 'zod' // smaller bundle compared to 'import { z } from 'zod';
import { projects, overlays, approvalStatusEnum, changeRequests, cities } from '../db/schema';
import { eq, inArray, or, and, sql, ne } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../database';
import {
  buildProjectModerationQuery,
  buildOverlayModerationQuery,
  buildPaginationConditions,
  buildPaginationResponse
} from '../db/helpers';
import { LocalFileStorage, R2StorageS3, getThumbnailFilename, streamToBuffer } from '../lib/storage';
import { scheduleImageCleanup, deleteImages, daysFromNow } from '../lib/imageCleanup';

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
    bucketName: process.env.R2_BUCKET_NAME!
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
    await r2Storage.put(thumbnailFilename, thumbnailBuffer.buffer as ArrayBuffer, { skipThumbnail: true });
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

// AI : Schema for version-aware approval to prevent race conditions
// Supports arrays but frontend only sends single items for individual approval/rejection
const setApprovalStatusWithVersionSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int(),
  status: z.enum(approvalStatusEnum.enumValues),
});

export const moderationRouter = router({
    // AI : Check for conflicts when approving a replacement overlay
    checkReplacementConflicts: adminProcedure
      .input(z.object({ overlayId: z.string().uuid() }))
      .query(async ({ input }) => {
        try {
          // AI : Get the overlay being approved
          const overlay = await db
            .select({
              id: overlays.id,
              replacesOverlayId: overlays.replacesOverlayId,
              filename: overlays.filename,
              caption: overlays.caption
            })
            .from(overlays)
            .where(eq(overlays.id, input.overlayId))
            .limit(1);

          if (overlay.length === 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Overlay not found' });
          }

          const replacesOverlayId = overlay[0].replacesOverlayId;

          // AI : If not a replacement, no conflicts to check
          if (!replacesOverlayId) {
            return {
              isReplacement: false,
              pendingChangeRequests: [],
              competingReplacements: []
            };
          }

          // AI : Get the original overlay being replaced
          const originalOverlay = await db
            .select({
              id: overlays.id,
              status: overlays.status,
              caption: overlays.caption,
              filename: overlays.filename
            })
            .from(overlays)
            .where(eq(overlays.id, replacesOverlayId))
            .limit(1);

          if (originalOverlay.length === 0 || originalOverlay[0].status !== 'approved') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot replace overlay that is not approved'
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
              createdAt: changeRequests.createdAt
            })
            .from(changeRequests)
            .where(and(
              eq(changeRequests.entityType, 'overlay'),
              eq(changeRequests.entityId, replacesOverlayId),
              eq(changeRequests.status, 'pending')
            ));

          // AI : Find competing replacement overlays (other pending overlays trying to replace the same original)
          const competingReplacements = await db
            .select({
              id: overlays.id,
              filename: overlays.filename,
              caption: overlays.caption,
              authorId: overlays.authorId,
              createdAt: overlays.createdAt
            })
            .from(overlays)
            .where(and(
              eq(overlays.replacesOverlayId, replacesOverlayId),
              eq(overlays.status, 'pending'),
              ne(overlays.id, input.overlayId)
            ));

          return {
            isReplacement: true,
            originalOverlayCaption: originalOverlay[0].caption,
            originalOverlayFilename: originalOverlay[0].filename,
            newOverlayFilename: overlay[0].filename,
            newOverlayCaption: overlay[0].caption,
            pendingChangeRequests: pendingChanges,
            competingReplacements: competingReplacements,
            hasConflicts: pendingChanges.length > 0 || competingReplacements.length > 0
          };
        } catch (error) {
          console.error('Error checking replacement conflicts:', error);
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to check replacement conflicts' });
        }
      }),

    getPendingSubmissions: adminProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).optional().default(50),
        cursor: z.string().uuid().optional(),
        sortBy: z.enum(['createdAt', 'updatedAt']).optional().default('createdAt'),
        cityId: z.string().uuid().optional(),
        countryCode: z.string().length(3).optional()
      }).optional())
      .query(async ({ input = {} }) => {
        try {
          const sortColumn = input.sortBy === 'updatedAt' ? projects.updatedAt : projects.createdAt;
          const limit = input.limit ?? 50;

          // AI : Step 1: Find all project IDs that need moderation (pending projects, pending overlays, or pending changes)
          const [projectsWithPendingOverlays, projectsWithPendingChanges] = await Promise.all([
            // AI : Projects with pending overlay submissions
            db.selectDistinct({ projectId: overlays.projectId })
              .from(overlays)
              .where(eq(overlays.status, 'pending')),
            
            // AI : Projects with pending change requests (on project or overlay)
            db.selectDistinct({ 
              projectId: sql<string>`CASE 
                WHEN ${changeRequests.entityType} = 'project' THEN ${changeRequests.entityId}
                WHEN ${changeRequests.entityType} = 'overlay' THEN ${overlays.projectId}
              END`.as('projectId')
            })
            .from(changeRequests)
            .leftJoin(overlays, eq(changeRequests.entityId, overlays.id))
            .where(sql`CASE 
              WHEN ${changeRequests.entityType} = 'project' THEN ${changeRequests.entityId} IS NOT NULL
              WHEN ${changeRequests.entityType} = 'overlay' THEN ${overlays.projectId} IS NOT NULL
            END`)
          ]);

          const projectIdsWithPendingOverlays = projectsWithPendingOverlays
            .map(p => p.projectId)
            .filter((id): id is string => id !== null);
          
          const projectIdsWithPendingChanges = projectsWithPendingChanges
            .map(p => p.projectId)
            .filter((id): id is string => id !== null);

          // AI : Step 2: Build filters for projects, overlays, and change requests
          const paginationConditions = await buildPaginationConditions(
            { cityId: input.cityId, countryCode: input.countryCode, cursor: input.cursor },
            sortColumn
          );

          // AI : Projects needing moderation: pending status OR have pending overlays OR have pending changes
          const projectModerationConditions = [
            or(
              eq(projects.status, 'pending'),
              ...(projectIdsWithPendingOverlays.length > 0 ? [inArray(projects.id, projectIdsWithPendingOverlays)] : []),
              ...(projectIdsWithPendingChanges.length > 0 ? [inArray(projects.id, projectIdsWithPendingChanges)] : [])
            ),
            ...paginationConditions
          ];

          // AI : Step 3: Fetch all moderation data in parallel
          const [projectsResult, overlaysResult, overlayChanges, projectChanges] = await Promise.all([
            // AI : Projects with pagination
            buildProjectModerationQuery(db)
              .where(and(...projectModerationConditions))
              .orderBy(sortColumn)
              .limit(limit + 1),
            
            // AI : All overlays from moderation projects (to show in project accordions)
            buildOverlayModerationQuery(db)
              .where(and(...projectModerationConditions)),
            
            // AI : Overlay change requests with city/country filters
            db.select({
              id: changeRequests.id,
              entityType: changeRequests.entityType,
              entityId: changeRequests.entityId,
              fieldName: changeRequests.fieldName,
              oldValue: changeRequests.oldValue,
              newValue: changeRequests.newValue,
              changeReason: changeRequests.changeReason,
              status: changeRequests.status,
              requestedBy: changeRequests.requestedBy,
              createdAt: changeRequests.createdAt,
            })
            .from(changeRequests)
            .leftJoin(overlays, eq(changeRequests.entityId, overlays.id))
            .leftJoin(projects, eq(overlays.projectId, projects.id))
            .leftJoin(cities, eq(projects.cityId, cities.id))
            .where(and(
              eq(changeRequests.entityType, 'overlay'),
              eq(changeRequests.status, 'pending'),
              ...paginationConditions
            )),

            // AI : Project change requests with city/country filters
            db.select({
              id: changeRequests.id,
              entityType: changeRequests.entityType,
              entityId: changeRequests.entityId,
              fieldName: changeRequests.fieldName,
              oldValue: changeRequests.oldValue,
              newValue: changeRequests.newValue,
              changeReason: changeRequests.changeReason,
              status: changeRequests.status,
              requestedBy: changeRequests.requestedBy,
              createdAt: changeRequests.createdAt,
            })
            .from(changeRequests)
            .leftJoin(projects, eq(changeRequests.entityId, projects.id))
            .leftJoin(cities, eq(projects.cityId, cities.id))
            .where(and(
              eq(changeRequests.entityType, 'project'),
              eq(changeRequests.status, 'pending'),
              ...paginationConditions
            ))
          ]);

          // AI : Step 4: Combine and format results
          const changeRequestsResult = [...overlayChanges, ...projectChanges]
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

          // AI : Detect conflicts - multiple pending requests for the same field
          const conflictMap = new Map<string, number>();
          for (const change of changeRequestsResult) {
            const key = `${change.entityType}:${change.entityId}:${change.fieldName}`;
            conflictMap.set(key, (conflictMap.get(key) || 0) + 1);
          }

          // AI : Add hasConflict flag to changes that have competing requests
          const changeRequestsWithConflictInfo = changeRequestsResult.map(change => {
            const key = `${change.entityType}:${change.entityId}:${change.fieldName}`;
            const hasConflict = (conflictMap.get(key) || 0) > 1;
            return {
              ...change,
              hasConflict
            };
          });

          const paginationResponse = buildPaginationResponse(projectsResult, limit);

          // AI : Filter out rejected and replaced overlays from moderation panel
          const visibleOverlays = overlaysResult.filter(
            overlay => overlay.status !== 'rejected' && overlay.status !== 'replaced'
          );

          const projectsWithOverlays = paginationResponse.items.map(project => ({
            ...project,
            overlays: visibleOverlays.filter(overlay => overlay.projectId === project.id),
          }));

          return {
            projects: projectsWithOverlays,
            overlays: visibleOverlays.filter(overlay => overlay.status === 'pending'),
            changeRequests: changeRequestsWithConflictInfo,
            pagination: paginationResponse.pagination
          };
        } catch (error) {
          console.error('Error fetching pending submissions:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch pending submissions' });
        }
      }),

    // AI : Undo project approval - restores project to previous status (typically pending)
    // Frontend always sends single ID wrapped in array: ids: [singleId]
    undoProjectApprovalStatus: adminProcedure
      .input(setApprovalStatusSchema)
      .mutation(async ({ input }) => {
        try {
          await db
            .update(projects)
            .set({ status: input.status })
            .where(eq(projects.id, input.id));
          return { success: true };
        } catch (error) {
          console.error('Error updating project status:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update project status' });
        }
      }),

    // AI : Undo overlay approval - restores overlay to previous status (typically pending)
    // Frontend always sends single ID wrapped in array: ids: [singleId]
    undoOverlayApprovalStatus: adminProcedure
      .input(setApprovalStatusSchema)
      .mutation(async ({ input }) => {
        try {
          await db
            .update(overlays)
            .set({ status: input.status })
            .where(eq(overlays.id, input.id));
          return { success: true };
        } catch (error) {
          console.error('Error updating overlay status:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update overlay status' });
        }
      }),

    // AI : Version-aware project approval to prevent race conditions
    // Frontend always sends single item wrapped in array: items: [{ id, expectedVersion }]
    setProjectApprovalStatusWithVersion: adminProcedure
      .input(setApprovalStatusWithVersionSchema)
      .mutation(async ({ input }) => {
        try {
          // AI : Atomic update with version check and pending status check in WHERE clause
          const result = await db
            .update(projects)
            .set({ status: input.status })
            .where(and(
              eq(projects.id, input.id),
              eq(projects.version, input.expectedVersion),
              eq(projects.status, 'pending') // AI : Only update pending projects
            ))
            .returning({ id: projects.id, version: projects.version });

          if (result.length === 0) {
            // AI : Either project doesn't exist, version mismatch, or already processed
            const currentProject = await db
              .select({ version: projects.version, status: projects.status })
              .from(projects)
              .where(eq(projects.id, input.id))
              .limit(1);

            if (currentProject.length === 0) {
              return { success: false, error: 'Project not found' };
            } else if (currentProject[0].status !== 'pending') {
              return { 
                success: false, 
                error: 'Project already processed', 
                currentStatus: currentProject[0].status 
              };
            } else {
              return { 
                success: false, 
                error: 'Version mismatch', 
                expectedVersion: input.expectedVersion,
                currentVersion: currentProject[0].version 
              };
            }
          }

          return { success: true };
        } catch (error) {
          console.error('Error updating project status with version:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update project status' });
        }
      }),

    // AI : Version-aware overlay approval to prevent race conditions
    // Frontend always sends single item wrapped in array: items: [{ id, expectedVersion }]
    setOverlayApprovalStatusWithVersion: adminProcedure
      .input(setApprovalStatusWithVersionSchema.extend({
        handleReplacementConflicts: z.boolean().optional().default(false), // AI : Whether to auto-handle replacement conflicts
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          // AI : Get overlay data for processing
          const overlayData = await db
            .select({
              id: overlays.id,
              filename: overlays.filename,
              replacesOverlayId: overlays.replacesOverlayId,
              status: overlays.status,
              version: overlays.version
            })
            .from(overlays)
            .where(eq(overlays.id, input.id))
            .limit(1);

          if (overlayData.length === 0) {
            return { success: false, error: 'Overlay not found' };
          }

          const overlay = overlayData[0];
          const overlayFilename = overlay.filename;
          const replacesOverlayId = overlay.replacesOverlayId;

          // AI : Handle rejection first (simpler case)
          if (input.status === 'rejected') {
            // AI : Atomic update with version check
            const result = await db
              .update(overlays)
              .set({ status: input.status, version: sql`${overlays.version} + 1` })
              .where(and(
                eq(overlays.id, input.id),
                eq(overlays.version, input.expectedVersion),
                eq(overlays.status, 'pending')
              ))
              .returning({ id: overlays.id, version: overlays.version });

            if (result.length === 0) {
              return { success: false, error: 'Version mismatch or already processed' };
            }

            // AI : Delete images for rejected overlays
            try {
              // AI : For both regular and replacement overlays: delete full immediately, keep thumbnail for 15 days
              // AI : Thumbnails allow users to see what was rejected in ModeratedContributionsDialog
              // AI : Uses deleteImages helper to handle both production/R2 and development/local
              await deleteImages(overlayFilename, 'full');
              await scheduleImageCleanup(input.id, overlayFilename, daysFromNow(15), 'thumbnail');
            } catch (cleanupError) {
              console.error('Failed to cleanup rejected overlay images:', cleanupError);
              // AI : Don't fail the rejection if cleanup fails
            }

            return { success: true };
          }

          // AI : Handle approval (more complex, especially for replacements)
          const transactionResult = await db.transaction(async (tx) => {
            // AI : Track competing replacements for post-transaction cleanup
            let competingReplacements: Array<{ id: string; filename: string }> = [];

            // AI : Lock and verify the overlay hasn't changed
            const currentOverlay = await tx
              .select({
                id: overlays.id,
                status: overlays.status,
                version: overlays.version,
                replacesOverlayId: overlays.replacesOverlayId
              })
              .from(overlays)
              .where(eq(overlays.id, input.id))
              .limit(1);

            if (currentOverlay.length === 0) {
              return { success: false, error: 'Overlay not found' };
            }

            // AI : Version and status checks
            if (currentOverlay[0].version !== input.expectedVersion) {
              return {
                success: false,
                error: 'Version mismatch',
                expectedVersion: input.expectedVersion,
                currentVersion: currentOverlay[0].version
              };
            }

            if (currentOverlay[0].status !== 'pending') {
              return {
                success: false,
                error: 'Overlay already processed',
                currentStatus: currentOverlay[0].status
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
                  filename: overlays.filename
                })
                .from(overlays)
                .where(eq(overlays.id, replacesOverlayId))
                .limit(1);

              if (originalOverlay.length === 0 || originalOverlay[0].status !== 'approved') {
                return {
                  success: false,
                  error: 'Original overlay not found or not approved'
                };
              }

              // AI : Mark original as 'replaced'
              await tx
                .update(overlays)
                .set({
                  status: 'replaced' as any, // AI : Cast needed due to enum type
                  replacedByOverlayId: input.id,
                  version: sql`${overlays.version} + 1`
                })
                .where(eq(overlays.id, replacesOverlayId));

              // AI : Mark all pending change requests as 'conflicted'
              await tx
                .update(changeRequests)
                .set({
                  status: 'conflicted',
                  resolvedAt: new Date(),
                  resolvedBy: ctx.user.id
                })
                .where(and(
                  eq(changeRequests.entityType, 'overlay'),
                  eq(changeRequests.entityId, replacesOverlayId),
                  eq(changeRequests.status, 'pending')
                ));

              // AI : Find and reject competing replacement overlays
              competingReplacements = await tx
                .select({ id: overlays.id, filename: overlays.filename })
                .from(overlays)
                .where(and(
                  eq(overlays.replacesOverlayId, replacesOverlayId),
                  eq(overlays.status, 'pending'),
                  ne(overlays.id, input.id)
                ));

              if (competingReplacements.length > 0) {
                await tx
                  .update(overlays)
                  .set({
                    status: 'rejected',
                    version: sql`${overlays.version} + 1`
                  })
                  .where(inArray(overlays.id, competingReplacements.map(o => o.id)));
              }
            }

            // AI : Approve the overlay
            const result = await tx
              .update(overlays)
              .set({
                status: 'approved',
                version: sql`${overlays.version} + 1`
              })
              .where(eq(overlays.id, input.id))
              .returning({ id: overlays.id });

            if (result.length === 0) {
              return { success: false, error: 'Failed to approve overlay' };
            }

            return { success: true, competingReplacements: replacesOverlayId ? competingReplacements : [] };
          });

          // AI : Return early if transaction failed
          if (!transactionResult.success) {
            return transactionResult;
          }

          // AI : AFTER successful transaction, handle image cleanup for replacement workflow
          if (replacesOverlayId && input.handleReplacementConflicts && transactionResult.competingReplacements) {
            // AI : Delete images for competing replacements
            for (const competing of transactionResult.competingReplacements) {
              try {
                // AI : Uses deleteImages helper to handle both production/R2 and development/local
                await deleteImages(competing.filename, 'full');
                await scheduleImageCleanup(competing.id, competing.filename, daysFromNow(15), 'thumbnail');
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
                await deleteImages(originalOverlayData[0].filename, 'full');
                await scheduleImageCleanup(replacesOverlayId, originalOverlayData[0].filename, daysFromNow(15), 'thumbnail');
              }
            } catch (error) {
              console.error(`Failed to cleanup replaced overlay images:`, error);
            }
          }

          // AI : After transaction, migrate image to R2 (outside transaction for safety)
          if (input.status === 'approved' && overlayFilename && process.env.NODE_ENV === 'production') {
            try {
              await migrateImageToR2(overlayFilename);
            } catch (migrationError) {
              console.error('Failed to migrate image to R2:', migrationError);
              // AI : Don't fail the approval if R2 migration fails - image is still accessible in local storage
            }
          }

          // AI : Return the transaction result
          return transactionResult;
        } catch (error) {
          console.error('Error updating overlay status with version:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update overlay status' });
        }
      }),
});
