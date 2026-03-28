import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import { publicProcedure, router, TRPCError } from "../trpc";
import { cities, projects } from "../db/schema";
import { sql, eq } from "drizzle-orm";
import { db } from "../database";
import {
  getUserOverlayChangeRequestIds,
  buildProjectVisibilityCondition,
  buildOverlayVisibilityCondition,
  fetchOverlayChangeRequests,
  transformOverlayDataWithChangeRequests,
  fetchOverlaysWithLocation,
} from "../db/helpers";

const getCitiesNearLocationSchema = z.object({
  lat: z.number().min(-90).max(90), // Valid latitude range
  lng: z.number().min(-180).max(180), // Valid longitude range
  limit: z.number().min(1).max(25).default(10), // Limit results between 1-25, default 10
});

const searchCitiesNearLocationSchema = z.object({
  lat: z.number().min(-90).max(90), // Valid latitude range
  lng: z.number().min(-180).max(180), // Valid longitude range
  search: z.string().min(1).max(100), // Limit search string to 100 characters
  limit: z.number().min(1).max(25).default(10), // Limit results between 1-25, default 10
});

const getCityOverlaysAndProjectsSchema = z.object({
  cityId: z.number(),
  mode: z.enum(["view", "edit", "moderation"]).optional().default("view"), // Map viewing mode
});

export const citiesRouter = router({
  // Get cities closest to given coordinates ordered by distance
  getCitiesNearLocation: publicProcedure
    .input(getCitiesNearLocationSchema)
    .query(async ({ input }) => {
      try {
        const { lat, lng, limit } = input;

        // Use PostGIS ST_Distance to calculate distance and order by closest
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

  // Get all approved projects and overlays for a specific city
  getCityOverlaysAndProjects: publicProcedure
    .input(getCityOverlaysAndProjectsSchema)
    .query(async ({ input, ctx }) => {
      try {
        const { cityId, mode } = input;

        // SECURITY: Reject moderation mode for unauthenticated users
        if (mode === "moderation" && !ctx.user) {
          throw new Error("Authentication required for moderation mode");
        }

        // Fetch user's overlay change request IDs if in edit mode
        const overlayChangeRequestIds =
          ctx.user && mode === "edit"
            ? await getUserOverlayChangeRequestIds(db, ctx.user.id)
            : undefined;

        // Build visibility conditions using helper functions
        const whereConditions = [
          eq(projects.cityId, cityId),
          // In moderation mode, disable strict filtering to show approved projects (context)
          buildProjectVisibilityCondition(ctx.user, mode, false),
          buildOverlayVisibilityCondition(ctx.user, mode, overlayChangeRequestIds),
        ];

        const overlaysData = await fetchOverlaysWithLocation(whereConditions);

        // Fetch and group change requests by overlay ID
        const changeRequestsByOverlay = await fetchOverlayChangeRequests(ctx.user, mode);

        // In moderation mode, count change requests per overlay
        const allChangeRequestCounts = new Map<string, number>();
        if (mode === "moderation") {
          for (const [overlayId, requests] of changeRequestsByOverlay) {
            allChangeRequestCounts.set(overlayId, requests.length);
          }
        }

        const result = transformOverlayDataWithChangeRequests(
          overlaysData,
          changeRequestsByOverlay,
          allChangeRequestCounts,
          mode,
          ctx.user?.id,
        );

        return result;
      } catch (error) {
        console.error("Error fetching city projects:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch city projects",
        });
      }
    }),

  // Search cities by name with project counts
  // Optimized for 48k cities with minimum character requirement and indexed ILIKE search
  searchCities: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(100), // Minimum 1 character to support short city names (e.g., Chinese cities)
        limit: z.number().min(1).max(50).default(25), // Limit results, default 25
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
