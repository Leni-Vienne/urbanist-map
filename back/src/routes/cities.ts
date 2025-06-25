import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { db } from '../db';
import { cities, projects, overlays } from '../db/schema';
import { sql, eq, isNotNull, inArray } from 'drizzle-orm';

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
    .query(async () => {
      try {
        // AI : Join cities with projects and return cities that have projects
        const result = await db
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
          .where(isNotNull(projects.cityId))
          .groupBy(cities.id, cities.name, cities.countryCode, cities.coordinates)
          .having(sql`COUNT(${projects.id}) > 0`);

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

        // AI : Get projects for the city with city info
        const projectsResult = await db
          .select({
            id: projects.id,
            title: projects.title,
            description: projects.description,
            cityId: projects.cityId,
            metadata: projects.metadata,
            createdAt: projects.createdAt,
            // AI : Include city information
            cityName: cities.name,
            cityCountryCode: cities.countryCode
          })
          .from(projects)
          .innerJoin(cities, eq(projects.cityId, cities.id))
          .where(eq(projects.cityId, cityId));        // AI : Get overlays for these projects  
        const projectIds = projectsResult.map(p => p.id);
        const overlaysResult = projectIds.length > 0 ? await db
          .select()
          .from(overlays)
          .where(inArray(overlays.projectId, projectIds)) : [];

        // AI : Combine projects with their overlays
        return projectsResult.map(project => ({
          id: project.id,
          title: project.title,
          description: project.description,
          cityId: project.cityId,
          city: {
            id: project.cityId,
            name: project.cityName,
            countryCode: project.cityCountryCode
          },
          metadata: project.metadata,
          createdAt: project.createdAt,
          overlays: overlaysResult
            .filter(overlay => overlay.projectId === project.id)
            .map(overlay => ({
              id: overlay.id,
              filename: overlay.filename,
              caption: overlay.caption,
              metadata: overlay.metadata,
              corners: {
                topLeft: { lat: overlay.topLeftLat, lng: overlay.topLeftLng },
                topRight: { lat: overlay.topRightLat, lng: overlay.topRightLng },
                bottomRight: { lat: overlay.bottomRightLat, lng: overlay.bottomRightLng },
                bottomLeft: { lat: overlay.bottomLeftLat, lng: overlay.bottomLeftLng }
              },
              createdAt: overlay.createdAt
            }))
        }));
      } catch (error) {
        console.error('Error fetching city projects:', error);
        throw new Error('Failed to fetch city projects');
      }
    }),
});
