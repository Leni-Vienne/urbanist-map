import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { db } from '../db';
import { cities } from '../db/schema';
import { sql } from 'drizzle-orm';

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
});
