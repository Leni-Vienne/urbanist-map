import * as z from "zod";
import { publicProcedure, router, TRPCError } from "../trpc";
import { cities } from "../db/schema";
import { sql, eq } from "drizzle-orm";
import { db } from "../database";

const getCitiesNearLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  limit: z.number().min(1).max(25).default(10),
});

const searchCitiesNearLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  search: z.string().min(1).max(100),
  limit: z.number().min(1).max(25).default(10),
});

export const citiesRouter = router({
  // Get city details by ID (for navigation purposes)
  getCityById: publicProcedure
    .input(
      z.object({
        cityId: z.number(),
      }),
    )
    .query(async ({ input }) => {
      try {
        const { cityId } = input;

        const result = await db
          .select({
            id: cities.id,
            name: cities.name,
            nameLocal: cities.nameLocal,
            countryCode: cities.countryCode,
            lat: sql<number>`ST_Y(${cities.coordinates})`,
            lng: sql<number>`ST_X(${cities.coordinates})`,
          })
          .from(cities)
          .where(eq(cities.id, cityId))
          .limit(1);

        if (result.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "City not found",
          });
        }

        return result[0];
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error("Error fetching city by ID:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch city details",
        });
      }
    }),
  // Get cities closest to given coordinates ordered by distance
  getCitiesNearLocation: publicProcedure
    .input(getCitiesNearLocationSchema)
    .query(async ({ input }) => {
      try {
        const { lat, lng, limit } = input;

        return await db
          .select({
            id: cities.id,
            name: cities.name,
            nameLocal: cities.nameLocal,
            countryCode: cities.countryCode,
            // Extract coordinates from PostGIS point
            lat: sql<number>`ST_Y(${cities.coordinates})`,
            lng: sql<number>`ST_X(${cities.coordinates})`,
            // Calculate distance in meters using spherical earth model
            distance: sql<number>`ST_Distance(
              ${cities.coordinates}, 
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
            )`,
          })
          .from(cities)
          .orderBy(sql`ST_Distance(
            ${cities.coordinates}, 
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
          )`)
          .limit(limit);
      } catch (error) {
        console.error("Error fetching cities near location:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch cities near location",
        });
      }
    }),

  // Get the country code of the nearest city to given coordinates
  getNearestCountryCode: publicProcedure
    .input(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
    .query(async ({ input }) => {
      try {
        const { lat, lng } = input;
        const result = await db
          .select({ countryCode: cities.countryCode })
          .from(cities)
          .orderBy(sql`${cities.coordinates} <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`)
          .limit(1);
        return result[0]?.countryCode ?? null;
      } catch (error) {
        console.error("Error fetching nearest country code:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch nearest country code",
        });
      }
    }),

  // Search cities near given coordinates with name filter
  searchCitiesNearLocation: publicProcedure
    .input(searchCitiesNearLocationSchema)
    .query(async ({ input }) => {
      try {
        const { lat, lng, search, limit } = input;

        // Use PostGIS ST_Distance to calculate distance, with smart ordering
        // Priority: exact match > starts with > contains, then by distance within each category
        const searchLower = search.trim().toLowerCase();
        const result = await db
          .select({
            id: cities.id,
            name: cities.name,
            nameLocal: cities.nameLocal,
            countryCode: cities.countryCode,
            // Extract coordinates from PostGIS point
            lat: sql<number>`ST_Y(${cities.coordinates})`,
            lng: sql<number>`ST_X(${cities.coordinates})`,
            approvedProjectCount: cities.approvedProjectCount,
            // Calculate distance in meters using spherical earth model
            distance: sql<number>`ST_Distance(
              ${cities.coordinates}, 
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
            )`,
          })
          .from(cities)
          .where(
            sql`(unaccent(${cities.name}) ILIKE unaccent(${`%${searchLower}%`}) OR unaccent(${cities.nameLocal}) ILIKE unaccent(${`%${searchLower}%`}))`,
          )
          .orderBy(
            // First priority: exact matches (case-insensitive, accent-insensitive)
            sql`CASE WHEN unaccent(LOWER(${cities.name})) = unaccent(${searchLower}) OR unaccent(LOWER(${cities.nameLocal})) = unaccent(${searchLower}) THEN 0 ELSE 1 END`,
            // Second priority: prefix matches (starts with search term)
            sql`CASE WHEN unaccent(LOWER(${cities.name})) LIKE unaccent(${`${searchLower}%`}) OR unaccent(LOWER(${cities.nameLocal})) LIKE unaccent(${`${searchLower}%`}) THEN 0 ELSE 1 END`,
            // Third priority: cities with projects
            sql`CASE WHEN ${cities.approvedProjectCount} > 0 THEN 0 ELSE 1 END`,
            // Finally: order by distance within each category
            sql`ST_Distance(
              ${cities.coordinates}, 
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
            )`,
          )
          .limit(limit);

        return result;
      } catch (error) {
        console.error("Error searching cities near location:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search cities near location",
        });
      }
    }),

  // Search cities by name with project counts
  // Optimized for 48k cities with minimum character requirement and indexed ILIKE search
  searchCities: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(100), // min 1 supports short city names (e.g. Chinese cities)
        limit: z.number().min(1).max(50).default(25),
      }),
    )
    .query(async ({ input }) => {
      try {
        const { query, limit } = input;

        // Use unaccent() for accent-insensitive search (e.g., "Montreal" matches "Montréal")
        // Order by cities with projects first, then alphabetically
        const searchPattern = `${query.trim()}%`;
        return await db
          .select({
            id: cities.id,
            name: cities.name,
            nameLocal: cities.nameLocal,
            countryCode: cities.countryCode,
            // Extract coordinates from PostGIS point
            lat: sql<number>`ST_Y(${cities.coordinates})`,
            lng: sql<number>`ST_X(${cities.coordinates})`,
            approvedProjectCount: cities.approvedProjectCount,
          })
          .from(cities)
          .where(
            sql`(unaccent(${cities.name}) ILIKE unaccent(${searchPattern}) OR unaccent(${cities.nameLocal}) ILIKE unaccent(${searchPattern}))`,
          ) // Match against both English and local names, accent-insensitive
          .orderBy(
            sql`(${cities.approvedProjectCount} > 0) DESC`, // Cities with projects first
            cities.name, // Then alphabetically by English name
          )
          .limit(limit);
      } catch (error) {
        console.error("Error searching cities:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search cities",
        });
      }
    }),
});
