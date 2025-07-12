import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { db } from '../db';
import {
  cities, projects, overlays,
} from '../db/schema';
import {
  sql, eq, isNotNull, and,
} from 'drizzle-orm';

const getCitiesNearLocationSchema = z.object({
  lat: z.number().min(-90).max(90), // AI : Valid latitude range
  lng: z.number().min(-180).max(180), // AI : Valid longitude range
  limit: z.number().min(1).max(50).default(10) // AI : Limit results between 1-50, default 10
});

const searchCitiesNearLocationSchema = z.object({
  lat: z.number().min(-90).max(90), // AI : Valid latitude range
  lng: z.number().min(-180).max(180), // AI : Valid longitude range
  search: z.string().min(1).max(100), // AI : Limit search string to 100 characters
  limit: z.number().min(1).max(50).default(10) // AI : Limit results between 1-50, default 10
});

const getCityProjectsSchema = z.object({
  cityId: z.string().uuid() // AI : City ID to get projects for
});

export const citiesRouter = router({
  // AI : Get cities closest to given coordinates ordered by distance
  getCitiesNearLocation: publicProcedure
    .input(getCitiesNearLocationSchema)
    .query(async ({ input }) => {
      try {
        const { lat, lng, limit } = input;
        
        // AI : Use PostGIS ST_Distance to calculate distance and order by closest
        const result = await db
          .select({
            id: cities.id,
            name: cities.name,
            countryCode: cities.countryCode,
            // AI : Extract coordinates from PostGIS point
            lat: sql<number>`ST_Y(${cities.coordinates})`,
            lng: sql<number>`ST_X(${cities.coordinates})`,
            // AI : Calculate distance in meters using spherical earth model
            distance: sql<number>`ST_Distance(
              ${cities.coordinates}, 
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
            )`
          })
          .from(cities)
          .orderBy(sql`ST_Distance(
            ${cities.coordinates}, 
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
          )`)
          .limit(limit);

        return result;
      } catch (error) {
        console.error('Error fetching cities near location:', error);
        throw new Error('Failed to fetch cities near location');
      }
    }),

  // AI : Search cities near given coordinates with name filter
  searchCitiesNearLocation: publicProcedure
    .input(searchCitiesNearLocationSchema)
    .query(async ({ input }) => {
      try {
        const { lat, lng, search, limit } = input;
        
        // AI : Use PostGIS ST_Distance to calculate distance and order by closest, with name filter
        const result = await db
          .select({
            id: cities.id,
            name: cities.name,
            countryCode: cities.countryCode,
            // AI : Extract coordinates from PostGIS point
            lat: sql<number>`ST_Y(${cities.coordinates})`,
            lng: sql<number>`ST_X(${cities.coordinates})`,
            // AI : Calculate distance in meters using spherical earth model
            distance: sql<number>`ST_Distance(
              ${cities.coordinates}, 
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
            )`
          })
          .from(cities)
          .where(sql`${cities.name} ILIKE ${'%' + search.trim() + '%'}`)
          .orderBy(sql`ST_Distance(
            ${cities.coordinates}, 
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
          )`)
          .limit(limit);

        return result;
      } catch (error) {
        console.error('Error searching cities near location:', error);
        throw new Error('Failed to search cities near location');
      }
    }),

  // AI : Get all cities that have at least one project
  getCitiesWithProjects: publicProcedure
    .input(z.object({
      countryCode: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const conditions = [isNotNull(projects.cityId)];
        if (input.countryCode) {
          conditions.push(eq(cities.countryCode, input.countryCode));
        }
        
        // AI : Join cities with projects and return cities that have projects
        const query = db
          .selectDistinct({
            id: cities.id,
            name: cities.name,
            countryCode: cities.countryCode,
            // AI : Extract coordinates from PostGIS point
            lat: sql<number>`ST_Y(${cities.coordinates})`,
            lng: sql<number>`ST_X(${cities.coordinates})`,
            // AI : Count number of projects in this city
            projectCount: sql<number>`COUNT(${projects.id})`
          })
          .from(cities)
          .innerJoin(projects, eq(cities.id, projects.cityId))
          .where(and(...conditions))
          .groupBy(cities.id, cities.name, cities.countryCode, cities.coordinates)
          .having(sql`COUNT(${projects.id}) > 0`);

        const result = await query;

        return result;
      } catch (error) {
        console.error('Error fetching cities with projects:', error);
        throw new Error('Failed to fetch cities with projects');
      }
    }),
  // AI : Get all projects and overlays for a specific city
  getCityProjects: publicProcedure
    .input(getCityProjectsSchema)
    .query(async ({ input }) => {
      try {
        const { cityId } = input;
        
        // AI : Get all overlays for projects in this city with centroid coordinates in one query
        const overlaysWithCentroids = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            caption: overlays.caption,
            status: overlays.status,
            projectId: overlays.projectId,
            authorId: overlays.authorId,
            metadata: overlays.metadata,
            topLeftLat: overlays.topLeftLat,
            topLeftLng: overlays.topLeftLng,
            topRightLat: overlays.topRightLat,
            topRightLng: overlays.topRightLng,
            bottomRightLat: overlays.bottomRightLat,
            bottomRightLng: overlays.bottomRightLng,
            bottomLeftLat: overlays.bottomLeftLat,
            bottomLeftLng: overlays.bottomLeftLng,
            lat: sql<number>`ST_Y(${overlays.centroid})`,
            lng: sql<number>`ST_X(${overlays.centroid})`,
            createdAt: overlays.createdAt,
            updatedAt: overlays.updatedAt,
          })
          .from(overlays)
          .innerJoin(projects, eq(overlays.projectId, projects.id))
          .where(eq(projects.cityId, cityId));

        // AI : Get all projects for this city
        const projectsResult = await db.query.projects.findMany({
          where: eq(projects.cityId, cityId),
        });

        // AI : Group overlays by project ID and attach to projects
        const overlaysByProject = overlaysWithCentroids.reduce((acc, overlay) => {
          const projectId = overlay.projectId;
          if (projectId) {
            if (!acc[projectId]) {
              acc[projectId] = [];
            }
            acc[projectId].push(overlay);
          }
          return acc;
        }, {} as Record<string, typeof overlaysWithCentroids>);

        const projectsWithOverlays = projectsResult.map(project => ({
          ...project,
          overlays: overlaysByProject[project.id] ?? [],
        }));

        return projectsWithOverlays;
      } catch (error) {
        console.error('Error fetching city projects:', error);
        throw new Error('Failed to fetch city projects');
      }
    }),
});
