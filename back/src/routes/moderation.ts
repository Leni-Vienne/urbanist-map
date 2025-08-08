import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, overlays, approvalStatusEnum, cities, countries } from '../db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

const setApprovalStatusSchema = z.object({
  ids: z.array(z.string().uuid()),
  status: z.enum(approvalStatusEnum.enumValues),
});

export function createModerationRouter(db: PostgresJsDatabase<typeof schema>) {
  return router({
    getPendingSubmissions: publicProcedure
      .query(async () => {
        try {
          const pendingProjects = db
            .select()
            .from(projects)
            .where(eq(projects.status, 'pending'));

          const pendingOverlays = db
            .select({
              id: overlays.id,
              name: sql<string>`coalesce(${overlays.caption}, 'Unnamed')`,
              filename: overlays.filename,
              city: cities.name,
              updatedAt: overlays.updatedAt,
              projectName: projects.name,
              countryCode: countries.code,
              countryName: countries.name,
            })
            .from(overlays)
            .leftJoin(projects, eq(overlays.projectId, projects.id))
            .leftJoin(cities, eq(projects.cityId, cities.id))
            .leftJoin(countries, eq(cities.countryCode, countries.code))
            .where(eq(overlays.status, 'pending'));

          const [projectsResult, overlaysResult] = await Promise.all([
            pendingProjects,
            pendingOverlays,
          ]);

          return {
            projects: projectsResult,
            overlays: overlaysResult,
          };
        } catch (error) {
          console.error('Error fetching pending submissions:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch pending submissions' });
        }
      }),

    setProjectApprovalStatus: publicProcedure
      .input(setApprovalStatusSchema)
      .mutation(async ({ input }) => {
        try {
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

    setOverlayApprovalStatus: publicProcedure
      .input(setApprovalStatusSchema)
      .mutation(async ({ input }) => {
        try {
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
