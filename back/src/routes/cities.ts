import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import { publicProcedure, router, TRPCError } from "../trpc";
import { cities, projects, overlays, changeRequests } from "../db/schema";
import { sql, eq, isNotNull, and } from "drizzle-orm";
import { db } from "../database";
import type { OverlayData } from "@shared/types";
import {
  getUserOverlayChangeRequestIds,
  buildProjectVisibilityCondition,
  buildOverlayVisibilityCondition,
  buildProjectHasVisibleContentCondition,
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

  // Get all cities that have at least one approved project (or user's own pending contributions in edit mode)
  getCitiesWithProjects: publicProcedure
    .input(
      z.object({
        countryCode: z.string().optional(),
        mode: z.enum(["view", "edit", "moderation"]).optional().default("view"), // Map viewing mode
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        // SECURITY: Reject moderation mode for unauthenticated users
        if (input.mode === "moderation" && !ctx.user) {
          throw new Error("Authentication required for moderation mode");
        }

        // Fetch user's overlay change request IDs if in edit mode
        const overlayChangeRequestIds =
          ctx.user && input.mode === "edit"
            ? await getUserOverlayChangeRequestIds(db, ctx.user.id)
            : undefined;

        // Build visibility conditions using helper functions
        const conditions = [
          isNotNull(projects.cityId),
          buildProjectVisibilityCondition(ctx.user, input.mode),
          buildProjectHasVisibleContentCondition(ctx.user, input.mode, overlayChangeRequestIds),
        ];

        if (input.countryCode) {
          conditions.push(eq(cities.countryCode, input.countryCode));
        }

        // Join cities with projects and return cities that have matching projects
        return await db
          .selectDistinct({
            id: cities.id,
            name: cities.name,
            nameLocal: cities.nameLocal,
            countryCode: cities.countryCode,
            // Extract coordinates from PostGIS point
            lat: sql<number>`ST_Y(${cities.coordinates})`,
            lng: sql<number>`ST_X(${cities.coordinates})`,
            // Count number of matching projects in this city
            projectCount: sql<number>`COUNT(${projects.id})`,
          })
          .from(cities)
          .innerJoin(projects, eq(cities.id, projects.cityId))
          .where(and(...conditions))
          .groupBy(cities.id, cities.name, cities.countryCode, cities.coordinates)
          .having(sql`COUNT(${projects.id}) > 0`);
      } catch (error) {
        console.error("Error fetching cities with projects:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch cities with projects",
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

        // Single optimized query that extracts all data including corners as JSON
        // Uses Drizzle ORM for main data to preserve Date objects through superjson
        const overlaysData = await db
          .select({
            // Select overlay fields individually to avoid geometry column issues
            overlayId: overlays.id,
            overlayVersion: overlays.version,
            overlayFilename: overlays.filename,
            overlayCaption: overlays.caption,
            overlayStatus: overlays.status,
            overlayProjectId: overlays.projectId,
            overlayAuthorId: overlays.authorId,
            overlayReplacesOverlayId: overlays.replacesOverlayId,
            overlayReplacedByOverlayId: overlays.replacedByOverlayId,
            overlayCreatedAt: overlays.createdAt,
            overlayUpdatedAt: overlays.updatedAt,
            // Extract centroid and corners directly in the query
            centroidLat: sql<number>`ST_Y(${overlays.centroid})`,
            centroidLng: sql<number>`ST_X(${overlays.centroid})`,
            // Extract corners as JSON array in a single query
            corners: sql<{ lat: number; lng: number }[]>`(
                SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
                FROM ST_DumpPoints(${overlays.corners}) AS dump(path, geom)
                WHERE path[2] <= 4
              )`,
            // Select project fields (all are safe - no geometry columns)
            project: projects,
            // Select city fields individually, extract coordinates from geometry
            cityId: cities.id,
            city: cities,
          })
          .from(overlays)
          .innerJoin(projects, eq(projects.id, overlays.projectId))
          .innerJoin(cities, eq(cities.id, projects.cityId))
          .where(and(...whereConditions))
          .orderBy(overlays.createdAt);

        // Fetch change requests based on mode
        let changeRequestsData: {
          id: string;
          entityType: string;
          entityId: string;
          fieldName: string;
          newValue: unknown;
          requestedBy: string | null;
        }[] = [];

        if (ctx.user) {
          if (mode === "edit") {
            // In edit mode, fetch only user's own pending change requests
            changeRequestsData = await db
              .select({
                id: changeRequests.id,
                entityType: changeRequests.entityType,
                entityId: changeRequests.entityId,
                fieldName: changeRequests.fieldName,
                newValue: changeRequests.newValue,
                requestedBy: changeRequests.requestedBy,
              })
              .from(changeRequests)
              .where(
                and(
                  eq(changeRequests.requestedBy, ctx.user.id),
                  eq(changeRequests.entityType, "overlay"),
                  eq(changeRequests.status, "pending"),
                ),
              );
          } else if (mode === "moderation") {
            // In moderation mode, fetch ALL pending change requests to show suggested positions
            changeRequestsData = await db
              .select({
                id: changeRequests.id,
                entityType: changeRequests.entityType,
                entityId: changeRequests.entityId,
                fieldName: changeRequests.fieldName,
                newValue: changeRequests.newValue,
                requestedBy: changeRequests.requestedBy,
              })
              .from(changeRequests)
              .where(
                and(eq(changeRequests.entityType, "overlay"), eq(changeRequests.status, "pending")),
              );
          }
        }

        // Group change requests by overlay ID for easy lookup
        const changeRequestsByOverlay = new Map<string, typeof changeRequestsData>();
        for (const cr of changeRequestsData) {
          const existing = changeRequestsByOverlay.get(cr.entityId) ?? [];
          existing.push(cr);
          changeRequestsByOverlay.set(cr.entityId, existing);
        }

        // In moderation mode, count change requests per overlay
        const allChangeRequestCounts = new Map<string, number>();
        if (mode === "moderation") {
          for (const [overlayId, requests] of changeRequestsByOverlay) {
            allChangeRequestCounts.set(overlayId, requests.length);
          }
        }

        const result: OverlayData[] = overlaysData.map((row) => {
          const approvedCorners = row.corners;
          const centroid = { lat: row.centroidLat, lng: row.centroidLng };

          // Get change requests for this overlay
          const overlayChangeRequests = changeRequestsByOverlay.get(row.overlayId) ?? [];

          // Check for pending corners change request
          const cornersChangeRequest = overlayChangeRequests.find(
            (cr) => cr.fieldName === "corners",
          );
          const hasPendingCorners = Boolean(cornersChangeRequest);
          const suggestedCorners =
            hasPendingCorners && cornersChangeRequest?.newValue
              ? (cornersChangeRequest.newValue as { lat: number; lng: number }[])
              : null;

          // ALWAYS use consistent field names - no more flipping!
          // - corners = ALWAYS approved position (database value)
          // - suggestedCorners = pending changes if they exist
          // Frontend decides what to display based on mode + user state

          // Determine if user has their own pending changes
          const userHasPendingChanges =
            mode === "edit" && overlayChangeRequests.some((cr) => cr.requestedBy === ctx.user?.id);

          return {
            id: row.overlayId,
            version: row.overlayVersion,
            filename: row.overlayFilename,
            caption: row.overlayCaption,
            status: row.overlayStatus,
            projectId: row.overlayProjectId,
            authorId: row.overlayAuthorId,
            replacesOverlayId: row.overlayReplacesOverlayId,
            replacedByOverlayId: row.overlayReplacedByOverlayId ?? null,
            createdAt: row.overlayCreatedAt,
            updatedAt: row.overlayUpdatedAt,
            centroid,
            corners: approvedCorners, // ALWAYS approved position from database
            suggestedCorners: suggestedCorners ?? undefined, // Suggested position if pending changes exist
            distance: 0,
            project: {
              ...row.project,
              city: row.city,
            },
            // Flag for user's own pending changes (edit mode) or any pending changes (moderation mode)
            hasPendingChanges: mode === "moderation" ? hasPendingCorners : userHasPendingChanges,
            // In moderation mode, add count of ALL pending change requests for this overlay
            pendingChangeRequestsCount:
              mode === "moderation" ? (allChangeRequestCounts.get(row.overlayId) ?? 0) : undefined,
          };
        });

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
