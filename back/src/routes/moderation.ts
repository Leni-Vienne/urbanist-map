import { adminProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, overlays, approvalStatusEnum, cities, countries, changeRequests } from '../db/schema';
import { eq, inArray, sql, or, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../database';

const setApprovalStatusSchema = z.object({
  ids: z.array(z.uuid()),
  status: z.enum(approvalStatusEnum.enumValues),
});

// AI : New schema for version-aware approval to prevent race conditions
const setApprovalStatusWithVersionSchema = z.object({
  items: z.array(z.object({
    id: z.uuid(),
    expectedVersion: z.number(), // AI : Version the moderator reviewed
  })),
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
          const moderationProjects = db
            .select({
              id: projects.id,
              name: projects.name,
              description: projects.description,
              status: projects.status,
              version: projects.version, // AI : Include version for optimistic locking
              createdAt: projects.createdAt,
              updatedAt: projects.updatedAt,
              startDate: projects.startDate,
              endDate: projects.endDate,
              sourceUrl: projects.sourceUrl,
              cityName: cities.name,
              countryCode: countries.code,
              countryName: countries.name,
            })
            .from(projects)
            .leftJoin(cities, eq(projects.cityId, cities.id))
            .leftJoin(countries, eq(cities.countryCode, countries.code))
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
          const projectOverlays = db
            .select({
              id: overlays.id,
              name: sql<string>`coalesce(${overlays.caption}, 'Unnamed')`,
              filename: overlays.filename,
              status: overlays.status,
              version: overlays.version, // AI : Include version for optimistic locking
              projectId: overlays.projectId,
              updatedAt: overlays.updatedAt,
              cityName: cities.name,
              countryCode: countries.code,
              countryName: countries.name,
            })
            .from(overlays)
            .leftJoin(projects, eq(overlays.projectId, projects.id))
            .leftJoin(cities, eq(projects.cityId, cities.id))
            .leftJoin(countries, eq(cities.countryCode, countries.code))
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
            overlays: overlaysResult.filter(overlay => overlay.status === 'pending'), // Keep for backward compatibility
            changeRequests: changeRequestsResult,
          };
        } catch (error) {
          console.error('Error fetching pending submissions:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch pending submissions' });
        }
      }),

    setProjectApprovalStatus: adminProcedure
      .input(setApprovalStatusSchema)
      .mutation(async ({ input }) => {
        try {
          // AI : Guard against empty array to prevent SQL errors
          if (input.ids.length === 0) {
            return { success: true };
          }
          
          await db
            .update(projects)
            .set({ status: input.status })
            .where(inArray(projects.id, input.ids));
          return { success: true };
        } catch (error) {
          console.error('Error updating project status:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update project status' });
        }
      }),

    setOverlayApprovalStatus: adminProcedure
      .input(setApprovalStatusSchema)
      .mutation(async ({ input }) => {
        try {
          // AI : Guard against empty array to prevent SQL errors
          if (input.ids.length === 0) {
            return { success: true };
          }
          
          await db
            .update(overlays)
            .set({ status: input.status })
            .where(inArray(overlays.id, input.ids));
          return { success: true };
        } catch (error) {
          console.error('Error updating overlay status:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update overlay status' });
        }
      }),

    // AI : Version-aware project approval to prevent race conditions
    setProjectApprovalStatusWithVersion: adminProcedure
      .input(setApprovalStatusWithVersionSchema)
      .mutation(async ({ input }) => {
        try {
          if (input.items.length === 0) {
            return { success: true, conflicts: [] };
          }

          const conflicts = [];
          const successfulUpdates: string[] = [];

          // AI : Process each item individually with atomic version check
          for (const item of input.items) {
            // AI : Atomic update with version check and pending status check in WHERE clause
            const result = await db
              .update(projects)
              .set({ status: input.status })
              .where(and(
                eq(projects.id, item.id),
                eq(projects.version, item.expectedVersion),
                eq(projects.status, 'pending') // AI : Only update pending projects
              ))
              .returning({ id: projects.id, version: projects.version });

            if (result.length === 0) {
              // AI : Either project doesn't exist, version mismatch, or already processed
              const currentProject = await db
                .select({ version: projects.version, status: projects.status })
                .from(projects)
                .where(eq(projects.id, item.id))
                .limit(1);

              if (currentProject.length === 0) {
                conflicts.push({ id: item.id, error: 'Project not found' });
              } else if (currentProject[0].status !== 'pending') {
                conflicts.push({ 
                  id: item.id, 
                  error: 'Project already processed', 
                  currentStatus: currentProject[0].status 
                });
              } else {
                conflicts.push({ 
                  id: item.id, 
                  error: 'Version mismatch', 
                  expectedVersion: item.expectedVersion,
                  currentVersion: currentProject[0].version 
                });
              }
            } else {
              successfulUpdates.push(item.id);
            }
          }

          // AI : Return success if at least one update succeeded, conflicts for others
          return { 
            success: conflicts.length === 0, 
            conflicts,
            successfulUpdates: successfulUpdates.length > 0 ? successfulUpdates : undefined
          };
        } catch (error) {
          console.error('Error updating project status with version:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update project status' });
        }
      }),

    // AI : Version-aware overlay approval to prevent race conditions  
    setOverlayApprovalStatusWithVersion: adminProcedure
      .input(setApprovalStatusWithVersionSchema)
      .mutation(async ({ input }) => {
        try {
          if (input.items.length === 0) {
            return { success: true, conflicts: [] };
          }

          const conflicts = [];
          const successfulUpdates: string[] = [];

          // AI : Process each item individually with atomic version check
          for (const item of input.items) {
            // AI : Atomic update with version check and pending status check in WHERE clause
            const result = await db
              .update(overlays)
              .set({ status: input.status })
              .where(and(
                eq(overlays.id, item.id),
                eq(overlays.version, item.expectedVersion),
                eq(overlays.status, 'pending') // AI : Only update pending overlays
              ))
              .returning({ id: overlays.id, version: overlays.version });

            if (result.length === 0) {
              // AI : Either overlay doesn't exist, version mismatch, or already processed
              const currentOverlay = await db
                .select({ version: overlays.version, status: overlays.status })
                .from(overlays)
                .where(eq(overlays.id, item.id))
                .limit(1);

              if (currentOverlay.length === 0) {
                conflicts.push({ id: item.id, error: 'Overlay not found' });
              } else if (currentOverlay[0].status !== 'pending') {
                conflicts.push({ 
                  id: item.id, 
                  error: 'Overlay already processed', 
                  currentStatus: currentOverlay[0].status 
                });
              } else {
                conflicts.push({ 
                  id: item.id, 
                  error: 'Version mismatch', 
                  expectedVersion: item.expectedVersion,
                  currentVersion: currentOverlay[0].version 
                });
              }
            } else {
              successfulUpdates.push(item.id);
            }
          }

          // AI : Return success if at least one update succeeded, conflicts for others
          return { 
            success: conflicts.length === 0, 
            conflicts,
            successfulUpdates: successfulUpdates.length > 0 ? successfulUpdates : undefined
          };
        } catch (error) {
          console.error('Error updating overlay status with version:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update overlay status' });
        }
      }),
});
