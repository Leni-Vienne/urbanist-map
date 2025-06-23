import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { db } from '../db';
import { cities, projects, overlays } from '../db/schema';
import { sql, eq, isNotNull } from 'drizzle-orm';

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

        // AI : Get all projects for the city with their overlays
        const result = await db
          .select({
            projectId: projects.id,
            projectTitle: projects.title,
            projectDescription: projects.description,
            projectMetadata: projects.metadata,
            projectCreatedAt: projects.createdAt,
            overlayId: overlays.id,
            overlayFilename: overlays.filename,
            overlayCaption: overlays.caption,
            overlayMetadata: overlays.metadata,
            overlayTopLeftLat: overlays.topLeftLat,
            overlayTopLeftLng: overlays.topLeftLng,
            overlayTopRightLat: overlays.topRightLat,
            overlayTopRightLng: overlays.topRightLng,
            overlayBottomRightLat: overlays.bottomRightLat,
            overlayBottomRightLng: overlays.bottomRightLng,
            overlayBottomLeftLat: overlays.bottomLeftLat,
            overlayBottomLeftLng: overlays.bottomLeftLng,
            overlayCreatedAt: overlays.createdAt
          })
          .from(projects)
          .leftJoin(overlays, eq(projects.id, overlays.projectId))
          .where(eq(projects.cityId, cityId))
          .orderBy(projects.createdAt, overlays.createdAt);

        // AI : Group results by project
        const groupedResults = result.reduce((acc, row) => {
          const projectId = row.projectId;
          
          if (!acc[projectId]) {
            acc[projectId] = {
              id: row.projectId,
              title: row.projectTitle,
              description: row.projectDescription,
              metadata: row.projectMetadata,
              createdAt: row.projectCreatedAt,
              overlays: []
            };
          }

          // AI : Add overlay if it exists
          if (row.overlayId) {
            acc[projectId].overlays.push({
              id: row.overlayId,
              filename: row.overlayFilename,
              caption: row.overlayCaption,
              metadata: row.overlayMetadata,
              corners: {
                topLeft: { lat: row.overlayTopLeftLat, lng: row.overlayTopLeftLng },
                topRight: { lat: row.overlayTopRightLat, lng: row.overlayTopRightLng },
                bottomRight: { lat: row.overlayBottomRightLat, lng: row.overlayBottomRightLng },
                bottomLeft: { lat: row.overlayBottomLeftLat, lng: row.overlayBottomLeftLng }
              },
              createdAt: row.overlayCreatedAt
            });
          }

          return acc;
        }, {} as Record<string, any>);

        return Object.values(groupedResults);
      } catch (error) {
        console.error('Error fetching city projects:', error);
        throw new Error('Failed to fetch city projects');
      }
    }),
});
