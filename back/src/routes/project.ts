import { publicProcedure, protectedProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, cities, overlays } from '../db/schema';
import { eq, sql, and, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../database';
import { buildProjectWithLocationQuery, buildOverlayModerationQuery } from '../db/queryBuilders';

// AI : Nearby search radius configuration
const NEARBY_SEARCH_RADIUS_METERS = 10 * 1000; // 10km

const publishProjectSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(8).max(200),
  description: z.string().max(2000).optional(),
  cityId: z.uuid().optional(),
  isMarker: z.boolean().optional().default(false), // AI : true for development projects, false for overlay projects
  lat: z.number().optional(), // AI : latitude for development projects
  lng: z.number().optional(), // AI : longitude for development projects
  proposalDate: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sourceUrl: z.url().optional(),
  latestUpdateOn: z.string().optional()
});

export const projectRouter = router({
  publishProject: protectedProcedure
    .input(publishProjectSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.cityId) {
          const city = await db.select().from(cities).where(eq(cities.id, input.cityId)).limit(1);
          if (city.length === 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'City not found' });
          }
        }

        // AI : Validate development project requirements
        if (input.isMarker && (!input.lat || !input.lng)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Development projects require lat and lng coordinates' });
        }

        const data = {
          ...input,
          ownerId: ctx.user.id,
          cityId: input.cityId ?? null,
          proposalDate: input.proposalDate ? new Date(input.proposalDate) : null,
          startDate: input.startDate ? new Date(input.startDate) : null,
          endDate: input.endDate ? new Date(input.endDate) : null,
          sourceUrl: input.sourceUrl,
          latestUpdateOn: input.latestUpdateOn ? new Date(input.latestUpdateOn) : null,
          // AI : Set coordinates for development projects using PostGIS
          coordinates: input.isMarker && input.lat && input.lng 
            ? sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)`
            : null,
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
                isMarker: data.isMarker,
                lat: data.lat,
                lng: data.lng,
                coordinates: data.coordinates,
                proposalDate: data.proposalDate,
                startDate: data.startDate,
                endDate: data.endDate,
                sourceUrl: data.sourceUrl,
                latestUpdateOn: data.latestUpdateOn,
                version: sql`${projects.version} + 1`, // AI : Increment version on update for optimistic locking
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
            version: projects.version,
            description: projects.description,
            ownerId: projects.ownerId,
            cityId: projects.cityId,
            metadata: projects.metadata,
            proposalDate: projects.proposalDate,
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
              ${NEARBY_SEARCH_RADIUS_METERS}
            )`
          ))
          .groupBy(
            projects.id,
            projects.name,
            projects.description,
            projects.ownerId,
            projects.cityId,
            projects.metadata,
            projects.proposalDate,
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
        cityId: z.uuid(),
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
              isMarker: projects.isMarker,
              lat: projects.lat,
              lng: projects.lng,
              proposalDate: projects.proposalDate,
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
              projects.isMarker,
              projects.lat,
              projects.lng,
              projects.proposalDate,
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
      
    // AI : Get user's own projects for contributions panel with overlays
    getUsersContributions: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(100).optional().default(50)
      }))
      .query(async ({ input, ctx }) => {
        try {
          // AI : Get all projects with full location info
          const allProjects = await buildProjectWithLocationQuery(db)
            .where(eq(projects.ownerId, ctx.user.id))
            .orderBy(sql`${projects.updatedAt} DESC`)
            .limit(input.limit);

          // AI : Get overlays for all projects with full location info
          const projectIds = allProjects.map(p => p.id);
          const projectOverlays = projectIds.length > 0 ? await buildOverlayModerationQuery(db)
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
