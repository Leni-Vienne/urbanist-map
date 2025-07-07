import { db } from '../db';
import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, cities, overlays, approvalStatusEnum } from '../db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

const publishProjectSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  cityId: z.string().uuid().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  source_url: z.string().url().optional(),
  latest_update_on: z.string().optional()
});

export const projectRouter = router({
  publishProject: publicProcedure
    .input(publishProjectSchema)
    .mutation(async ({ input }) => {
      try {
        if (input.cityId) {
          const city = await db.select().from(cities).where(eq(cities.id, input.cityId)).limit(1);
          if (city.length === 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'City not found' });
          }
        }

        const data = {
          ...input,
          //ownerId: ctx.session.userId,
          ownerId: null,
          cityId: input.cityId ?? null,
          start_date: input.start_date ? new Date(input.start_date) : null,
          end_date: input.end_date ? new Date(input.end_date) : null,
          source_url: input.source_url,
          latest_update_on: input.latest_update_on ? new Date(input.latest_update_on) : null,
        };

        if (input.id) {
          // Update existing project
          const result = await db.update(projects)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(projects.id, input.id))
            .returning();
          return { success: true, id: result[0].id, exists: true };
        } else {
          // Insert new project
          const result = await db.insert(projects)
            .values(data)
            .returning();
          return { success: true, id: result[0].id, exists: false };
        }
      } catch (error) {
        console.error('Error publishing project:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to publish project' });
      }
    }),
  // AI : Get projects with overlays within 10km of camera center
  getProjectsNearLocation: publicProcedure
    .input(z.object({
      lat: z.number(),
      lng: z.number(),
      radiusKm: z.number().default(10)
    }))
    .query(async ({ input }: { input: { lat: number; lng: number; radiusKm: number } }) => {
      try {
        const { lat, lng, radiusKm } = input;

        // AI : Find projects that have at least one overlay within the specified radius
        const nearbyProjects = await db
          .select({
            id: projects.id,
            title: projects.title,
            description: projects.description,
            ownerId: projects.ownerId,
            cityId: projects.cityId,
            metadata: projects.metadata,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
            // AI : Include city information when available
            city: {
              id: cities.id,
              name: cities.name,
              countryCode: cities.countryCode,
              lat: sql<number>`ST_Y(${cities.coordinates})`,
              lng: sql<number>`ST_X(${cities.coordinates})`
            }
          })
          .from(projects)
          .leftJoin(cities, eq(projects.cityId, cities.id))
          .innerJoin(overlays, eq(overlays.projectId, projects.id))
          .where(and(
            eq(projects.status, 'approved'),
            eq(overlays.status, 'approved'),
            sql`ST_DWithin(
              ${overlays.centroid},
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              ${radiusKm * 1000}
            )`
          ))
          .groupBy(
            projects.id,
            projects.title,
            projects.description,
            projects.ownerId,
            projects.cityId,
            projects.metadata,
            projects.createdAt,
            projects.updatedAt,
            cities.id,
            cities.name,
            cities.countryCode,
            cities.coordinates
          );

        return { projects: nearbyProjects };
      } catch (error) {
        console.error('Error fetching nearby projects:', error);
        throw new Error('Failed to fetch nearby projects');
      }
    })
});
