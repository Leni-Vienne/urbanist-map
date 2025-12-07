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
} from '../db/helpers';

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
          throw new Error('Failed to fetch cities near location', { cause: error });
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
            .where(sql`${cities.name} ILIKE ${`%${search.trim()}%`}`)
            .orderBy(sql`ST_Distance(
            ${cities.coordinates}, 
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
          )`)
            .limit(limit);

          return result;
        } catch (error) {
          console.error('Error searching cities near location:', error);
          throw new Error('Failed to search cities near location', { cause: error });
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
          throw new Error('Failed to fetch cities with projects', { cause: error });
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
              overlayReplacedByOverlayId: overlays.replacedByOverlayId,
              overlayCreatedAt: overlays.createdAt,
              overlayUpdatedAt: overlays.updatedAt,
              // AI : Extract centroid and corners directly in the query
              centroidLat: sql<number>`ST_Y(${overlays.centroid})`,
              centroidLng: sql<number>`ST_X(${overlays.centroid})`,
              // AI : Extract corners as JSON array in a single query
              corners: sql<{ lat: number; lng: number }[]>`(
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

          // AI : Fetch change requests based on mode
          let changeRequestsData: {
            id: string;
            entityType: string;
            entityId: string;
            fieldName: string;
            newValue: unknown;
            requestedBy: string | null;
          }[] = [];

          if (ctx.user) {
            if (mode === 'edit') {
              // AI : In edit mode, fetch only user's own pending change requests
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
                    eq(changeRequests.entityType, 'overlay'),
                    eq(changeRequests.status, 'pending')
                  )
                );
            } else if (mode === 'moderation') {
              // AI : In moderation mode, fetch ALL pending change requests to show suggested positions
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
                    eq(changeRequests.entityType, 'overlay'),
                    eq(changeRequests.status, 'pending')
                  )
                );
            }
          }

          // AI : Group change requests by overlay ID for easy lookup
          const changeRequestsByOverlay = new Map<string, typeof changeRequestsData>();
          changeRequestsData.forEach(cr => {
            const existing = changeRequestsByOverlay.get(cr.entityId) ?? [];
            existing.push(cr);
            changeRequestsByOverlay.set(cr.entityId, existing);
          });

          // AI : In moderation mode, count change requests per overlay
          let allChangeRequestCounts = new Map<string, number>();
          if (mode === 'moderation') {
            changeRequestsByOverlay.forEach((requests, overlayId) => {
              allChangeRequestCounts.set(overlayId, requests.length);
            });
          }

          const result: OverlayData[] = overlaysData.map((row) => {
            const approvedCorners = row.corners ?? [];
            const centroid = { lat: row.centroidLat, lng: row.centroidLng };

            // AI : Get change requests for this overlay
            const overlayChangeRequests = changeRequestsByOverlay.get(row.overlayId) ?? [];

            // AI : Check for pending corners change request
            const cornersChangeRequest = overlayChangeRequests.find(cr => cr.fieldName === 'corners');
            const hasPendingCorners = !!cornersChangeRequest;
            const suggestedCorners = hasPendingCorners && cornersChangeRequest?.newValue
              ? (cornersChangeRequest.newValue as { lat: number; lng: number }[])
              : null;

            // AI : ALWAYS use consistent field names - no more flipping!
            // - corners = ALWAYS approved position (database value)
            // - suggestedCorners = pending changes if they exist
            // Frontend decides what to display based on mode + user state

            // AI : Determine if user has their own pending changes
            const userHasPendingChanges = mode === 'edit' && overlayChangeRequests.some(cr => cr.requestedBy === ctx.user?.id);

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
              corners: approvedCorners, // AI : ALWAYS approved position from database
              suggestedCorners: suggestedCorners ?? undefined, // AI : Suggested position if pending changes exist
              distance: 0,
              project: {
                ...row.project,
                city: row.city
              },
              // AI : Flag for user's own pending changes (edit mode) or any pending changes (moderation mode)
              hasPendingChanges: mode === 'moderation' ? hasPendingCorners : userHasPendingChanges,
              // AI : In moderation mode, add count of ALL pending change requests for this overlay
              pendingChangeRequestsCount: mode === 'moderation' ? (allChangeRequestCounts.get(row.overlayId) ?? 0) : undefined,
            };
          });

          return result;

        } catch (error) {
          console.error('Error fetching city projects:', error);
          throw new Error('Failed to fetch city projects', { cause: error });
        }
      }),
});
