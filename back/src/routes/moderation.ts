import { adminProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, overlays, approvalStatusEnum, cities, countries } from '../db/schema';
import { eq, inArray, sql, or } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

const setApprovalStatusSchema = z.object({
  ids: z.array(z.string().uuid()),
  status: z.enum(approvalStatusEnum.enumValues),
});

export function createModerationRouter(db: PostgresJsDatabase<typeof schema>) {
  return router({
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

          const [projectsResult, overlaysResult] = await Promise.all([
            moderationProjects,
            projectOverlays,
          ]);

          // AI : Group overlays by project
          const projectsWithOverlays = projectsResult.map(project => ({
            ...project,
            overlays: overlaysResult.filter(overlay => overlay.projectId === project.id),
          }));

          return {
            projects: projectsWithOverlays,
            overlays: overlaysResult.filter(overlay => overlay.status === 'pending'), // Keep for backward compatibility
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
  });
}
