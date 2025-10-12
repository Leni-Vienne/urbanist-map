import { publicProcedure, protectedProcedure, router, TRPCError } from '../trpc';
import * as z from 'zod' // smaller bundle compared to 'import { z } from 'zod';
import { overlays, projects } from '../db/schema';
import { sql, eq, and } from 'drizzle-orm';
import { db } from '../database';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { buildOverlayQuery } from '../db/queryBuilders';

const publishOverlaySchema = z.object({
  id: z.uuid(), // AI : UUID length limit
  filename: z.string().min(1).max(255), // AI : Standard filename length limit
  caption: z.string().max(500).optional(), // AI : Limit caption to 500 characters
  projectId: z.uuid(), // AI : UUID length limit for project reference
  replacesOverlayId: z.uuid().optional(), // AI : UUID for overlay replacement
  corners: z.array(z.object({
    lat: z.number().min(-90).max(90), // AI : Valid latitude range
    lng: z.number().min(-180).max(180) // AI : Valid longitude range
  })).length(4) // AI : Exactly 4 corners required
});

const getOverlaySchema = z.object({
  id: z.uuid(),
  includeIntersecting: z.boolean().optional().default(false),
  includeStatus: z.array(z.enum(['pending', 'approved', 'rejected'])).optional(), // AI : Optional status filter for admins
});

const getLatestOverlaysSchema = z.object({
  limit: z.number().min(1).max(20).optional().default(20),
  cityId: z.uuid().optional(), // AI : Filter by city if provided
  includeStatus: z.array(z.enum(['pending', 'approved', 'rejected'])).optional(), // AI : Optional status filter for admins
});

// AI : Schema for updating overlay fields directly
const updateOverlaySchema = z.object({
  id: z.uuid(),
  caption: z.string().max(500).optional(), // AI : Allow updating caption
});

// AI : Shared select fields and query builder moved to back/src/db/queryBuilders.ts to eliminate duplication

// AI : Find overlays that intersect with a given overlay using PostGIS spatial queries
async function findIntersectingOverlays(db: PostgresJsDatabase<typeof schema>, excludeId: string, targetOverlay: { corners: {lat: number, lng: number}[] }) {
  try {
    // AI : Construct the target polygon once as WKT string - avoids expensive polygon construction for every row
    const [topLeft, topRight, bottomRight, bottomLeft] = targetOverlay.corners;
    const targetPolygonWKT = `POLYGON((${topLeft.lng} ${topLeft.lat}, ${topRight.lng} ${topRight.lat}, ${bottomRight.lng} ${bottomRight.lat}, ${bottomLeft.lng} ${bottomLeft.lat}, ${topLeft.lng} ${topLeft.lat}))`;

    // AI : Use PostGIS ST_Intersects with precomputed target polygon for optimal performance
    // AI : Only return approved overlays
    const intersectingOverlays = await buildOverlayQuery(db)
      .where(sql`
        ${overlays.id} != ${excludeId} AND
        ${overlays.status} = 'approved' AND
        ST_Intersects(
          ST_GeomFromText(${targetPolygonWKT}, 4326),
          ${overlays.corners}
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
    .query(async ({ input, ctx }) => {
      try {
        // AI : Build the where conditions array dynamically
        const whereConditions = [];

        // AI : If includeStatus is provided and user is admin, filter by those statuses
        // AI : Otherwise, only show approved overlays with approved parent projects
        if (input.includeStatus && ctx.user?.role === 'admin') {
          if (input.includeStatus.length > 0) {
            whereConditions.push(sql`${overlays.status} = ANY(ARRAY[${sql.join(input.includeStatus.map(s => sql.raw(`'${s}'`)), sql.raw(', '))}])`);
            whereConditions.push(sql`${projects.status} = ANY(ARRAY[${sql.join(input.includeStatus.map(s => sql.raw(`'${s}'`)), sql.raw(', '))}])`);
          }
        } else {
          whereConditions.push(eq(overlays.status, 'approved'));
          whereConditions.push(eq(projects.status, 'approved'));
        }

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
    .query(async ({ input, ctx }) => {
      try {
        // AI : Build where conditions based on status filter
        const whereConditions = [eq(overlays.id, input.id)];

        // AI : If includeStatus is provided and user is admin, filter by those statuses
        // AI : If user is logged in (but not admin), allow approved overlays + their own contributions
        // AI : Otherwise (anonymous), only show approved overlays
        if (input.includeStatus && ctx.user?.role === 'admin') {
          if (input.includeStatus.length > 0) {
            whereConditions.push(sql`${overlays.status} = ANY(ARRAY[${sql.join(input.includeStatus.map(s => sql.raw(`'${s}'`)), sql.raw(', '))}])`);
          }
        } else if (ctx.user) {
          // AI : Logged in users can see approved overlays OR their own contributions (any status)
          whereConditions.push(sql`(${overlays.status} = 'approved' OR ${overlays.authorId} = ${ctx.user.id})`);
        } else {
          // AI : Anonymous users only see approved overlays
          whereConditions.push(eq(overlays.status, 'approved'));
        }

        // AI : Fetch the requested overlay
        const overlay = await buildOverlayQuery(db)
          .where(and(...whereConditions))
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

        // AI : Calculate centroid (center point) using all 4 corners for distorted overlays
        const centroidLat = (topLeft.lat + topRight.lat + bottomRight.lat + bottomLeft.lat) / 4;
        const centroidLng = (topLeft.lng + topRight.lng + bottomRight.lng + bottomLeft.lng) / 4;

        // AI : Build WKT string with corner coordinates concatenated as a string literal
        const polygonWKT = `POLYGON((${topLeft.lng} ${topLeft.lat}, ${topRight.lng} ${topRight.lat}, ${bottomRight.lng} ${bottomRight.lat}, ${bottomLeft.lng} ${bottomLeft.lat}, ${topLeft.lng} ${topLeft.lat}))`;

        // AI : Prepare overlay data for insert/update
        const overlayData = {
          id: input.id,
          filename: input.filename,
          caption: input.caption,
          projectId: input.projectId,
          authorId: ctx.user.id,
          replacesOverlayId: input.replacesOverlayId ?? null,
          corners: sql.raw(`ST_GeomFromText('${polygonWKT}', 4326)`),
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
              corners: overlayData.corners,
              centroid: overlayData.centroid,
              version: sql`${overlays.version} + 1`, // AI : Increment version on update for optimistic locking
              updatedAt: sql`NOW()`
            }
          })
          .returning({
            id: overlays.id,
            createdAt: overlays.createdAt,
            updatedAt: overlays.updatedAt
          });

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

  // AI : Update overlay fields directly (for pending overlays)
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
          .set({ ...updateData, version: sql`${overlays.version} + 1`, updatedAt: new Date() }) // AI : Increment version on update for optimistic locking
          .where(eq(overlays.id, input.id));

        return { success: true };
      } catch (error) {
        console.error('Error updating overlay:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update overlay' });
      }
    }),
});
