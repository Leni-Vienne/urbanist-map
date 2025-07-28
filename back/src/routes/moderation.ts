import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, overlays, approvalStatusEnum, cities } from '../db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getDb } from '../shared/db-util';

const setApprovalStatusSchema = z.object({
  ids: z.array(z.string().uuid()),
  status: z.enum(approvalStatusEnum.enumValues),
});

export const moderationRouter = router({
  getPendingSubmissions: publicProcedure
    .query(async () => {
      try {
        const pendingProjects = await getDb()
          .select()
          .from(projects)
          .where(eq(projects.status, 'pending'));

        const pendingOverlays = await getDb()
          .select({
            id: overlays.id,
            name: sql<string>`coalesce(${overlays.caption}, 'Unnamed')`,
            city: cities.name,
          })
          .from(overlays)
          .leftJoin(projects, eq(overlays.projectId, projects.id))
          .leftJoin(cities, eq(projects.cityId, cities.id))
          .where(eq(overlays.status, 'pending'));

        return {
          projects: pendingProjects,
          overlays: pendingOverlays,
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
        await getDb()
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
        await getDb()
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
