import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, cities, overlays } from '../db/schema';
import { eq, sql, and, inArray } from 'drizzle-orm';
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
          ownerId: null, // AI : Projects can be created anonymously for now
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
            // AI : Count overlays for this project within the search radius
            overlayCount: sql<number>`COUNT(${overlays.id})::int`,
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
    }),

    // AI : Get projects by city
    getProjectsByCity: publicProcedure
      .input(z.object({
        cityId: z.string().uuid(),
        limit: z.number().min(1).max(100).optional().default(20)
      }))
      .query(async ({ input }) => {
        try {
          const projectsInCity = await db
            .select({
              id: projects.id,
              name: projects.name,
              description: projects.description,
              ownerId: projects.ownerId,
              cityId: projects.cityId,
              startDate: projects.startDate,
              endDate: projects.endDate,
              sourceUrl: projects.sourceUrl,
              latestUpdateOn: projects.latestUpdateOn,
              createdAt: projects.createdAt,
              updatedAt: projects.updatedAt,
              // AI : Count approved overlays for each project
              overlayCount: sql<number>`COUNT(CASE WHEN ${overlays.status} = 'approved' THEN 1 END)::int`,
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
            .leftJoin(overlays, eq(overlays.projectId, projects.id))
            .where(eq(projects.cityId, input.cityId))
            .groupBy(
              projects.id,
              projects.name,
              projects.description,
              projects.ownerId,
              projects.cityId,
              projects.startDate,
              projects.endDate,
              projects.sourceUrl,
              projects.latestUpdateOn,
              projects.createdAt,
              projects.updatedAt,
              cities.id,
              cities.name,
              cities.countryCode,
              cities.coordinates
            )
            .orderBy(sql`${projects.createdAt} DESC`)
            .limit(input.limit);

          return projectsInCity;
        } catch (error) {
          console.error('Error fetching projects by city:', error);
          throw new Error('Failed to fetch projects by city');
        }
      }),
      
    // AI : Get all projects for contributions panel with overlays
    getAllProjects: publicProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).optional().default(50)
      }))
      .query(async ({ input }) => {
        try {
          // AI : Get all projects
          const allProjects = await db
            .select({
              id: projects.id,
              name: projects.name,
              description: projects.description,
              status: projects.status,
              ownerId: projects.ownerId,
              cityId: projects.cityId,
              startDate: projects.startDate,
              endDate: projects.endDate,
              sourceUrl: projects.sourceUrl,
              latestUpdateOn: projects.latestUpdateOn,
              createdAt: projects.createdAt,
              updatedAt: projects.updatedAt,
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
            .orderBy(sql`${projects.updatedAt} DESC`)
            .limit(input.limit);

          // AI : Get overlays for all projects
          const projectIds = allProjects.map(p => p.id);
          const projectOverlays = projectIds.length > 0 ? await db
            .select({
              id: overlays.id,
              name: sql<string>`coalesce(${overlays.caption}, 'Unnamed')`,
              filename: overlays.filename,
              status: overlays.status,
              projectId: overlays.projectId,
              updatedAt: overlays.updatedAt,
              cityName: cities.name,
              countryCode: cities.countryCode,
              countryName: cities.name,
            })
            .from(overlays)
            .leftJoin(projects, eq(overlays.projectId, projects.id))
            .leftJoin(cities, eq(projects.cityId, cities.id))
            .where(inArray(overlays.projectId, projectIds))
            .orderBy(overlays.updatedAt) : [];

          // AI : Group overlays by project and add overlay count
          const projectsWithOverlays = allProjects.map(project => ({
            ...project,
            overlays: projectOverlays.filter(overlay => overlay.projectId === project.id),
            overlayCount: projectOverlays.filter(overlay => overlay.projectId === project.id).length,
          }));

          return projectsWithOverlays;
        } catch (error) {
          console.error('Error fetching all projects:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch all projects' });
        }
      })
  });
}
