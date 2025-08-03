import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, cities, overlays } from '../db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

const publishProjectSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  cityId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  latestUpdateOn: z.string().optional()
});

export function createProjectRouter(db: PostgresJsDatabase<typeof schema>) {
  return router({
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
          startDate: input.startDate ? new Date(input.startDate) : null,
          endDate: input.endDate ? new Date(input.endDate) : null,
          sourceUrl: input.sourceUrl,
          latestUpdateOn: input.latestUpdateOn ? new Date(input.latestUpdateOn) : null,
        };

        if (input.id) {
          // AI : Use upsert operation for existing project ID to avoid race conditions
          const result = await db
            .insert(projects)
            .values({ ...data, id: input.id })
            .onConflictDoUpdate({
              target: projects.id,
              set: {
                name: data.name,
                description: data.description,
                cityId: data.cityId,
                startDate: data.startDate,
                endDate: data.endDate,
                sourceUrl: data.sourceUrl,
                latestUpdateOn: data.latestUpdateOn,
                updatedAt: new Date()
              }
            })
            .returning();
          
          return { 
            success: true, 
            id: result[0].id, 
            exists: result[0].createdAt !== result[0].updatedAt // AI : Determine if it was update or insert
          };
        } else {
          // AI : Insert new project without ID (will get auto-generated UUID)
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
  // AI : Get projects with overlays within 100km of camera center
  getProjectsNearLocation: publicProcedure
    .input(z.object({
      lat: z.number(),
      lng: z.number(),
    }))
    .query(async ({ input }: { input: { lat: number; lng: number;} }) => {
      try {
        const { lat, lng } = input;

        // AI : Find projects that have at least one overlay within the specified radius
        const nearbyProjects = await db
          .select({
            id: projects.id,
            name: projects.name,
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
            sql`${overlays.centroid} IS NOT NULL`,
            sql`ST_DWithin(
              ${overlays.centroid},
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              ${10 * 1000}
            )`
          ))
          .groupBy(
            projects.id,
            projects.name,
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
}
