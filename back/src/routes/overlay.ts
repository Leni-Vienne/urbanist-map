import { publicProcedure, protectedProcedure, router, TRPCError } from '../trpc';
import { z } from 'zod';
import { overlays, projects, cities, countries } from '../db/schema';
import { sql, eq, and } from 'drizzle-orm';
import { db } from '../database';
import type { OverlayWithDetails } from '../shared/types';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

const publishOverlaySchema = z.object({
  id: z.string().min(1).max(36), // AI : UUID length limit
  filename: z.string().min(1).max(255), // AI : Standard filename length limit
  caption: z.string().max(500).optional(), // AI : Limit caption to 500 characters
  projectId: z.string().min(1).max(36), // AI : UUID length limit for project reference
  replacesOverlayId: z.string().min(1).max(36).optional(), // AI : UUID for overlay replacement
  metadata: z.json().optional(),
  corners: z.array(z.object({
    lat: z.number().min(-90).max(90), // AI : Valid latitude range
    lng: z.number().min(-180).max(180) // AI : Valid longitude range
  })).length(4) // AI : Exactly 4 corners required
});

const getOverlaySchema = z.object({
  id: z.string().uuid(),
  includeIntersecting: z.boolean().optional().default(false),
});

const getLatestOverlaysSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  cityId: z.string().uuid().optional(), // AI : Filter by city if provided
});

// AI : Schema for updating overlay metadata fields directly
const updateOverlaySchema = z.object({
  id: z.uuid(),
  caption: z.string().max(500).optional(), // AI : Allow updating caption
});

// AI : Shared select fields for overlay queries to reduce duplication
const overlaySelectFields = {
  id: overlays.id,
  filename: overlays.filename,
  caption: overlays.caption,
  status: overlays.status,
  projectId: overlays.projectId,
  authorId: overlays.authorId,
  replacesOverlayId: overlays.replacesOverlayId,
  metadata: overlays.metadata,
  topLeftLat: overlays.topLeftLat,
  topLeftLng: overlays.topLeftLng,
  topRightLat: overlays.topRightLat,
  topRightLng: overlays.topRightLng,
  bottomRightLat: overlays.bottomRightLat,
  bottomRightLng: overlays.bottomRightLng,
  bottomLeftLat: overlays.bottomLeftLat,
  bottomLeftLng: overlays.bottomLeftLng,
  centroid: overlays.centroid,
  createdAt: overlays.createdAt,
  updatedAt: overlays.updatedAt,
  projectName: projects.name,
  cityName: cities.name,
  cityId: cities.id,
  countryCode: countries.code,
  countryName: countries.name,
};

// AI : Base query builder for overlays with joins
function buildOverlayQuery(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select(overlaySelectFields)
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .leftJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}

// AI : Find overlays that intersect with a given overlay using PostGIS spatial queries
async function findIntersectingOverlays(db: PostgresJsDatabase<typeof schema>, excludeId: string, targetOverlay: OverlayWithDetails) {
  try {
    // AI : Construct the target polygon once as WKT string - avoids expensive polygon construction for every row
    const targetPolygonWKT = `POLYGON((${targetOverlay.topLeftLng} ${targetOverlay.topLeftLat}, ${targetOverlay.topRightLng} ${targetOverlay.topRightLat}, ${targetOverlay.bottomRightLng} ${targetOverlay.bottomRightLat}, ${targetOverlay.bottomLeftLng} ${targetOverlay.bottomLeftLat}, ${targetOverlay.topLeftLng} ${targetOverlay.topLeftLat}))`;

    // AI : Use PostGIS ST_Intersects with precomputed target polygon for optimal performance
    const intersectingOverlays = await db
      .select(overlaySelectFields)
      .from(overlays)
      .leftJoin(projects, eq(overlays.projectId, projects.id))
      .leftJoin(cities, eq(projects.cityId, cities.id))
      .leftJoin(countries, eq(cities.countryCode, countries.code))
      .where(sql`
        ${overlays.id} != ${excludeId} AND
        ST_Intersects(
          ST_GeomFromText(${targetPolygonWKT}, 4326),
          ST_SetSRID(ST_MakePolygon(ST_MakeLine(ARRAY[
            ST_MakePoint(${overlays.topLeftLng}, ${overlays.topLeftLat}),
            ST_MakePoint(${overlays.topRightLng}, ${overlays.topRightLat}),
            ST_MakePoint(${overlays.bottomRightLng}, ${overlays.bottomRightLat}),
            ST_MakePoint(${overlays.bottomLeftLng}, ${overlays.bottomLeftLat}),
            ST_MakePoint(${overlays.topLeftLng}, ${overlays.topLeftLat})
          ])), 4326)
        )
      `);

    return intersectingOverlays;
  } catch (error) {
    console.error('Error finding intersecting overlays:', error);
    throw new Error('Failed to find intersecting overlays');
  }
}

export const overlayRouter = router({
  getLatestOverlays: publicProcedure
    .input(getLatestOverlaysSchema)
    .query(async ({ input }) => {
      try {
        // AI : Build the where conditions array dynamically
        const whereConditions = [eq(overlays.status, 'approved')];

        // AI : Add city filter if provided
        if (input.cityId) {
          whereConditions.push(eq(projects.cityId, input.cityId));
        }

        // AI : Apply all where conditions at once using AND logic
        return await buildOverlayQuery(db)
          .where(and(...whereConditions))
          .orderBy(sql`${overlays.updatedAt} DESC`)
          .limit(input.limit);

      } catch (error) {
        console.error('Error fetching latest overlays:', error);
        throw new Error('Failed to fetch latest overlays');
      }
    }),

  getOverlay: publicProcedure
    .input(getOverlaySchema)
    .query(async ({ input }) => {
      try {
        // AI : Fetch the requested overlay
        const overlay = await buildOverlayQuery(db)
          .where(eq(overlays.id, input.id))
          .limit(1);

        if (!overlay.length) {
          throw new Error('Overlay not found');
        }

        let intersectingOverlays: Awaited<ReturnType<typeof findIntersectingOverlays>> = [];

        // AI : If includeIntersecting is true, find overlays that intersect with the queried overlay
        if (input.includeIntersecting) {
          const queriedOverlay = overlay[0];
          intersectingOverlays = await findIntersectingOverlays(db, input.id, queriedOverlay);
        }

        return {
          overlay: overlay[0],
          intersectingOverlays
        };
      } catch (error) {
        console.error('Error fetching overlay:', error);
        throw new Error('Failed to fetch overlay');
      }
    }),

  publishOverlay: protectedProcedure
    .input(publishOverlaySchema)
    .mutation(async ({ input, ctx }) => {
      try {
        // AI : Extract corner coordinates
        const [topLeft, topRight, bottomRight, bottomLeft] = input.corners;

        // AI : Calculate centroid (center point)
        //const centroidLat = input.corners.reduce((sum, corner) => sum + corner.lat, 0) / 4;
        //const centroidLng = input.corners.reduce((sum, corner) => sum + corner.lng, 0) / 4;
        const centroidLat = (topLeft.lat + bottomLeft.lat) / 2;
        const centroidLng = (topLeft.lng + bottomLeft.lng) / 2;

        // AI : Prepare overlay data for insert/update
        const overlayData = {
          id: input.id,
          filename: input.filename,
          caption: input.caption,
          projectId: input.projectId,
          authorId: ctx.user.id,
          replacesOverlayId: input.replacesOverlayId ?? null,
          metadata: null, // AI : Keep metadata empty as requested
          topLeftLat: topLeft.lat,
          topLeftLng: topLeft.lng,
          topRightLat: topRight.lat,
          topRightLng: topRight.lng,
          bottomRightLat: bottomRight.lat,
          bottomRightLng: bottomRight.lng,
          bottomLeftLat: bottomLeft.lat,
          bottomLeftLng: bottomLeft.lng,
          centroid: sql`ST_SetSRID(ST_MakePoint(${centroidLng}, ${centroidLat}), 4326)`
        };

        // AI : Use upsert operation to avoid race conditions - atomic insert or update
        const result = await db
          .insert(overlays)
          .values(overlayData)
          .onConflictDoUpdate({
            target: overlays.id,
            set: {
              filename: overlayData.filename,
              caption: overlayData.caption,
              projectId: overlayData.projectId,
              authorId: overlayData.authorId,
              replacesOverlayId: overlayData.replacesOverlayId,
              metadata: overlayData.metadata,
              topLeftLat: overlayData.topLeftLat,
              topLeftLng: overlayData.topLeftLng,
              topRightLat: overlayData.topRightLat,
              topRightLng: overlayData.topRightLng,
              bottomRightLat: overlayData.bottomRightLat,
              bottomRightLng: overlayData.bottomRightLng,
              bottomLeftLat: overlayData.bottomLeftLat,
              bottomLeftLng: overlayData.bottomLeftLng,
              centroid: overlayData.centroid,
              updatedAt: sql`NOW()`
            }
          })
          .returning();

        return {
          success: true,
          id: result[0].id,
          exists: result[0].createdAt !== result[0].updatedAt // AI : Determine if it was update or insert
        };
      } catch (error) {
        console.error('Error publishing overlay:', error);
        throw new Error('Failed to publish overlay');
      }
    }),

  // AI : Update overlay metadata fields directly (for pending overlays)
  updateOverlay: protectedProcedure
    .input(updateOverlaySchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user?.id;
        if (!userId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Must be logged in to update overlay' });
        }

        // AI : Only allow owners to update their own overlays
        const existingOverlay = await db
          .select({ authorId: overlays.authorId })
          .from(overlays)
          .where(eq(overlays.id, input.id))
          .limit(1);

        if (existingOverlay.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Overlay not found' });
        }

        if (existingOverlay[0].authorId !== userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to update this overlay' });
        }

        // AI : Update only the provided fields
        const updateData: Partial<{ caption: string }> = {};
        if (input.caption !== undefined) {
          updateData.caption = input.caption;
        }

        await db
          .update(overlays)
          .set({ ...updateData, updatedAt: new Date() })
          .where(eq(overlays.id, input.id));

        return { success: true };
      } catch (error) {
        console.error('Error updating overlay:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update overlay' });
      }
    }),
});
