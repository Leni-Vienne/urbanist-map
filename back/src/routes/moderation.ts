import { adminProcedure, router } from '../trpc';
import * as z from 'zod' // smaller bundle compared to 'import { z } from 'zod';
import { projects, overlays, approvalStatusEnum, changeRequests } from '../db/schema';
import { eq, inArray, or, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../database';
import { buildProjectModerationQuery, buildOverlayModerationQuery } from '../db/queryBuilders';

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
    getPendingSubmissions: adminProcedure
      .query(async () => {
        try {
          // First, find all projects that have at least one pending overlay
          const projectsWithPendingOverlays = await db
            .selectDistinct({ projectId: overlays.projectId })
            .from(overlays)
            .where(eq(overlays.status, 'pending'));

          // AI : Extract project IDs and filter out nulls with proper TypeScript type narrowing
          // This ensures we have a clean array of strings for the inArray query
          const projectIdsWithPendingOverlays = projectsWithPendingOverlays.map(p => p.projectId).filter((id): id is string => id !== null);

          // AI : Query projects that need moderation - either directly pending OR have pending overlays
          const moderationProjects = buildProjectModerationQuery(db)
            .where(
              or(
                eq(projects.status, 'pending'),
                // AI : Only add inArray condition if we have project IDs to avoid empty array SQL error
                // Drizzle's inArray() fails with empty arrays, so we conditionally include it
                ...(projectIdsWithPendingOverlays.length > 0 ? [inArray(projects.id, projectIdsWithPendingOverlays)] : [])
              )
            )
            .orderBy(projects.createdAt);

          // AI : Get all overlays for these moderation projects (to show what needs review)
          const projectOverlays = buildOverlayModerationQuery(db)
            .where(
              or(
                eq(projects.status, 'pending'),
                // AI : Same empty array protection as above - only add inArray if we have IDs
                ...(projectIdsWithPendingOverlays.length > 0 ? [inArray(projects.id, projectIdsWithPendingOverlays)] : [])
              )
            );

          // AI : Get pending change requests
          const pendingChangeRequests = db
            .select({
              id: changeRequests.id,
              entityType: changeRequests.entityType,
              entityId: changeRequests.entityId,
              fieldName: changeRequests.fieldName,
              oldValue: changeRequests.oldValue,
              newValue: changeRequests.newValue,
              changeReason: changeRequests.changeReason,
              requestedBy: changeRequests.requestedBy,
              createdAt: changeRequests.createdAt,
            })
            .from(changeRequests)
            .orderBy(changeRequests.createdAt);

          const [projectsResult, overlaysResult, changeRequestsResult] = await Promise.all([
            moderationProjects,
            projectOverlays,
            pendingChangeRequests,
          ]);

          // AI : Group overlays by project
          const projectsWithOverlays = projectsResult.map(project => ({
            ...project,
            overlays: overlaysResult.filter(overlay => overlay.projectId === project.id),
          }));

          return {
            projects: projectsWithOverlays,
            overlays: overlaysResult.filter(overlay => overlay.status === 'pending'), // AI : Used by useModeration composable
            changeRequests: changeRequestsResult,
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
      .input(setApprovalStatusWithVersionSchema)
      .mutation(async ({ input }) => {
        try {
          // AI : Atomic update with version check and pending status check in WHERE clause
          const result = await db
            .update(overlays)
            .set({ status: input.status })
            .where(and(
              eq(overlays.id, input.id),
              eq(overlays.version, input.expectedVersion),
              eq(overlays.status, 'pending') // AI : Only update pending overlays
            ))
            .returning({ id: overlays.id, version: overlays.version });

          if (result.length === 0) {
            // AI : Either overlay doesn't exist, version mismatch, or already processed
            const currentOverlay = await db
              .select({ version: overlays.version, status: overlays.status })
              .from(overlays)
              .where(eq(overlays.id, input.id))
              .limit(1);

            if (currentOverlay.length === 0) {
              return { success: false, error: 'Overlay not found' };
            } else if (currentOverlay[0].status !== 'pending') {
              return { 
                success: false, 
                error: 'Overlay already processed', 
                currentStatus: currentOverlay[0].status 
              };
            } else {
              return { 
                success: false, 
                error: 'Version mismatch', 
                expectedVersion: input.expectedVersion,
                currentVersion: currentOverlay[0].version 
              };
            }
          }

          return { success: true };
        } catch (error) {
          console.error('Error updating overlay status with version:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update overlay status' });
        }
      }),
});
