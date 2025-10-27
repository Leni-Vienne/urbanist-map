import * as z from 'zod' // smaller bundle compared to 'import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import {
  cities, projects, overlays, changeRequests,
} from '../db/schema';
import {
  sql, eq, isNotNull, and,
} from 'drizzle-orm';
import { db } from '../database';
import type { OverlayData } from '../lib/types';
import {
  getUserOverlayChangeRequestIds,
  buildProjectVisibilityCondition,
  buildOverlayVisibilityCondition,
  buildProjectHasVisibleContentCondition
} from '../db/visibilityHelpers';

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

const getCityOverlaysAndProjectsSchema = z.object({
  cityId: z.uuid(),
  mode: z.enum(['view', 'edit', 'moderation']).optional().default('view') // AI : Map viewing mode
});

export const citiesRouter = router({
    // AI : Get cities closest to given coordinates ordered by distance
    getCitiesNearLocation: publicProcedure
      .input(getCitiesNearLocationSchema)
      .query(async ({ input }) => {
        try {
          const { lat, lng, limit } = input;

          // AI : Use PostGIS ST_Distance to calculate distance and order by closest
          return await db
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

    // AI : Get all cities that have at least one approved project (or user's own pending contributions in edit mode)
    getCitiesWithProjects: publicProcedure
      .input(z.object({
        countryCode: z.string().optional(),
        mode: z.enum(['view', 'edit', 'moderation']).optional().default('view') // AI : Map viewing mode
      }))
      .query(async ({ input, ctx }) => {
        try {
          // AI : Fetch user's overlay change request IDs if in edit mode
          const overlayChangeRequestIds = ctx.user && input.mode === 'edit'
            ? await getUserOverlayChangeRequestIds(db, ctx.user.id)
            : undefined;

          // AI : Build visibility conditions using helper functions
          const conditions = [
            isNotNull(projects.cityId),
            buildProjectVisibilityCondition(ctx.user, input.mode),
            buildProjectHasVisibleContentCondition(ctx.user, input.mode, overlayChangeRequestIds)
          ];

          if (input.countryCode) {
            conditions.push(eq(cities.countryCode, input.countryCode));
          }

          // AI : Join cities with projects and return cities that have matching projects
          return await db
            .selectDistinct({
              id: cities.id,
              name: cities.name,
              countryCode: cities.countryCode,
              // AI : Extract coordinates from PostGIS point
              lat: sql<number>`ST_Y(${cities.coordinates})`,
              lng: sql<number>`ST_X(${cities.coordinates})`,
              // AI : Count number of matching projects in this city
              projectCount: sql<number>`COUNT(${projects.id})`
            })
            .from(cities)
            .innerJoin(projects, eq(cities.id, projects.cityId))
            .where(and(...conditions))
            .groupBy(cities.id, cities.name, cities.countryCode, cities.coordinates)
            .having(sql`COUNT(${projects.id}) > 0`);

        } catch (error) {
          console.error('Error fetching cities with projects:', error);
          throw new Error('Failed to fetch cities with projects');
        }
      }),
    // AI : Get all approved projects and overlays for a specific city
    getCityOverlaysAndProjects: publicProcedure
      .input(getCityOverlaysAndProjectsSchema)
      .query(async ({ input, ctx }) => {
        try {
          const { cityId, mode } = input;

          // AI : Fetch user's overlay change request IDs if in edit mode
          const overlayChangeRequestIds = ctx.user && mode === 'edit'
            ? await getUserOverlayChangeRequestIds(db, ctx.user.id)
            : undefined;

          // AI : Build visibility conditions using helper functions
          const whereConditions = [
            eq(projects.cityId, cityId),
            buildProjectVisibilityCondition(ctx.user, mode),
            buildOverlayVisibilityCondition(ctx.user, mode, overlayChangeRequestIds)
          ];

          // AI : Single optimized query that extracts all data including corners as JSON
          // AI : Uses Drizzle ORM for main data to preserve Date objects through superjson
          const overlaysData = await db
            .select({
              // AI : Select overlay fields individually to avoid geometry column issues
              overlayId: overlays.id,
              overlayVersion: overlays.version,
              overlayFilename: overlays.filename,
              overlayCaption: overlays.caption,
              overlayStatus: overlays.status,
              overlayProjectId: overlays.projectId,
              overlayAuthorId: overlays.authorId,
              overlayReplacesOverlayId: overlays.replacesOverlayId,
              overlayCreatedAt: overlays.createdAt,
              overlayUpdatedAt: overlays.updatedAt,
              // AI : Extract centroid and corners directly in the query
              centroidLat: sql<number>`ST_Y(${overlays.centroid})`,
              centroidLng: sql<number>`ST_X(${overlays.centroid})`,
              // AI : Extract corners as JSON array in a single query
              corners: sql<Array<{ lat: number; lng: number }>>`(
                SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
                FROM ST_DumpPoints(${overlays.corners}) AS dump(path, geom)
                WHERE path[2] <= 4
              )`,
              // AI : Select project fields (all are safe - no geometry columns)
              project: projects,
              // AI : Select city fields individually, extract coordinates from geometry
              cityId: cities.id,
              city: cities
            })
            .from(overlays)
            .innerJoin(projects, eq(projects.id, overlays.projectId))
            .innerJoin(cities, eq(cities.id, projects.cityId))
            .where(and(...whereConditions))
            .orderBy(overlays.createdAt);

          // AI : In edit mode, fetch user's pending change requests to merge with overlays
          // AI : In moderation mode, do NOT apply user's own changes (show objective view)
          let userChangeRequests: Array<{
            id: string;
            entityType: string;
            entityId: string;
            fieldName: string;
            newValue: unknown;
          }> = [];

          if (ctx.user && mode === 'edit') {
            userChangeRequests = await db
              .select({
                id: changeRequests.id,
                entityType: changeRequests.entityType,
                entityId: changeRequests.entityId,
                fieldName: changeRequests.fieldName,
                newValue: changeRequests.newValue,
              })
              .from(changeRequests)
              .where(
                and(
                  eq(changeRequests.requestedBy, ctx.user.id),
                  eq(changeRequests.entityType, 'overlay')
                )
              );
          }

          // AI : In moderation mode, fetch count of ALL pending change requests per overlay
          let allChangeRequestCounts: Map<string, number> = new Map();
          if (ctx.user && mode === 'moderation') {
            const countResults = await db
              .select({
                entityId: changeRequests.entityId,
                count: sql<number>`COUNT(*)::int`
              })
              .from(changeRequests)
              .where(eq(changeRequests.entityType, 'overlay'))
              .groupBy(changeRequests.entityId);

            countResults.forEach(row => {
              allChangeRequestCounts.set(row.entityId, row.count);
            });
          }

          const result: OverlayData[] = overlaysData.map((row) => {
            // AI : ALWAYS use approved corners from database in 'corners' field
            // AI : Frontend will decide when to show suggested changes
            const corners = row.corners ?? [];
            const centroid = { lat: row.centroidLat, lng: row.centroidLng };

            // AI : Check if user has pending change requests for this overlay
            const overlayChangeRequests = userChangeRequests.filter(cr => cr.entityId === row.overlayId);

            return {
              id: row.overlayId,
              version: row.overlayVersion,
              filename: row.overlayFilename,
              caption: row.overlayCaption,
              status: row.overlayStatus,
              projectId: row.overlayProjectId,
              authorId: row.overlayAuthorId,
              replacesOverlayId: row.overlayReplacesOverlayId,
              createdAt: row.overlayCreatedAt,
              updatedAt: row.overlayUpdatedAt,
              centroid,
              corners, // AI : Always approved corners from database
              distance: 0,
              project: {
                ...row.project,
                city: row.city
              },
              // AI : Add flag to indicate if this overlay has pending change requests from the current user
              hasPendingChanges: overlayChangeRequests.length > 0,
              // AI : In moderation mode, add count of ALL pending change requests for this overlay
              pendingChangeRequestsCount: mode === 'moderation' ? (allChangeRequestCounts.get(row.overlayId) ?? 0) : undefined,
            };
          });

          return result;

        } catch (error) {
          console.error('Error fetching city projects:', error);
          throw new Error('Failed to fetch city projects');
        }
      }),
});
