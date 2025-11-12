import { publicProcedure, protectedProcedure, router, TRPCError } from '../trpc';
import * as z from 'zod' // smaller bundle compared to 'import { z } from 'zod';
import { overlays, projects } from '../db/schema';
import { sql, eq, and } from 'drizzle-orm';
import { db } from '../database';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import {
  buildOverlayQuery,
  buildProjectStatusCondition,
  buildOverlayVisibilityCondition,
  type ApprovalStatus,
  type MapMode
} from '../db/helpers';
import { validateOverlaySize } from '../utils/overlayValidation';
import { deleteLocalImages } from '../lib/imageCleanup';
import { checkPendingLimitForNewContribution } from '../db/contributionHelpers';

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
async function findIntersectingOverlays(db: PostgresJsDatabase<typeof schema>, excludeId: string, targetOverlay: { corners: { lat: number, lng: number }[] }) {
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
        // AI : Build visibility conditions using helper functions
        const whereConditions = [
          buildOverlayVisibilityCondition(ctx.user, 'view', undefined, input.includeStatus as ApprovalStatus[] | undefined),
          buildProjectStatusCondition(ctx.user, input.includeStatus as ApprovalStatus[] | undefined)
        ];

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
        // AI : Determine mode based on context - edit mode if logged in, view mode otherwise
        const mode: MapMode = ctx.user ? 'edit' : 'view';
        const whereConditions = [
          eq(overlays.id, input.id),
          buildOverlayVisibilityCondition(ctx.user, mode, undefined, input.includeStatus as ApprovalStatus[] | undefined)
        ];

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
          // AI : Validate overlay size before processing
          const sizeValidation = validateOverlaySize(input.corners);
          if (!sizeValidation.isValid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Overlay too large (max 1km × 1km)',
            });
          }

          // AI : Check pending contribution limit for new overlays
          await checkPendingLimitForNewContribution(ctx.user.id, input.id);

          // AI : Check if overlay already exists - approved overlays cannot be directly modified
          const existingOverlay = await db
            .select({ status: overlays.status })
            .from(overlays)
            .where(eq(overlays.id, input.id))
            .limit(1);

          // AI : Block any modification to approved overlays - must use change request system
          if (existingOverlay.length > 0 && existingOverlay[0].status === 'approved') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'APPROVED_OVERLAY_REQUIRES_CHANGE_REQUEST',
              cause: 'Modifying an approved overlay requires moderation approval. Please submit a change request instead.'
            });
          }

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
          // AI : Re-throw TRPCErrors as-is to preserve error codes and messages
          if (error instanceof TRPCError) {
            throw error;
          }
          // AI : Log and wrap unexpected errors
          console.error('Error publishing overlay:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to publish overlay',
            cause: error,
          });
        }
      }),  // AI : Update overlay fields directly (for pending overlays)
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

  // AI : Delete overlay (only pending overlays can be deleted by their owner)
  deleteOverlay: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user?.id;
        if (!userId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Must be logged in to delete overlay' });
        }

        // AI : Get overlay to check permissions and status
        const overlay = await db
          .select({
            id: overlays.id,
            authorId: overlays.authorId,
            status: overlays.status,
            filename: overlays.filename
          })
          .from(overlays)
          .where(eq(overlays.id, input.id))
          .limit(1);

        if (overlay.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Overlay not found' });
        }

        // AI : Only owner can delete their own overlay
        if (overlay[0].authorId !== userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to delete this overlay' });
        }

        // AI : Only pending overlays can be deleted
        if (overlay[0].status !== 'pending') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Can only delete pending overlays'
          });
        }

        // AI : Delete images first (safer - if DB delete fails, we just have orphaned files)
        try {
          await deleteLocalImages(overlay[0].filename, 'both');
          console.log(`Deleted local images for overlay ${input.id}`);
        } catch (imageError) {
          console.error(`Failed to delete images for overlay ${input.id}:`, imageError);
          // AI : Log to orphaned files but don't fail the deletion
          // The deleteLocalImages function handles logging internally
        }

        // AI : Delete from database
        await db.delete(overlays).where(eq(overlays.id, input.id));

        return { success: true };
      } catch (error) {
        console.error('Error deleting overlay:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete overlay' });
      }
    }),

  // AI : Get moderated contributions (rejected/replaced overlays) for the current user
  getModeratedContributions: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const userId = ctx.user?.id;
        if (!userId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Must be logged in' });
        }

        // AI : Get rejected and replaced overlays for this user with project/city info
        const moderatedOverlays = await db
          .select({
            id: overlays.id,
            caption: overlays.caption,
            filename: overlays.filename,
            status: overlays.status,
            updatedAt: overlays.updatedAt,
            projectId: overlays.projectId,
            replacedByOverlayId: overlays.replacedByOverlayId,
            projectName: projects.name,
          })
          .from(overlays)
          .leftJoin(projects, eq(overlays.projectId, projects.id))
          .where(and(
            eq(overlays.authorId, userId),
            sql`${overlays.status} IN ('rejected', 'replaced')`
          ))
          .orderBy(sql`${overlays.updatedAt} DESC`);

        return moderatedOverlays;
      } catch (error) {
        console.error('Error fetching moderated contributions:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch moderated contributions' });
      }
    }),

  // AI : Acknowledge/clear moderated contributions (immediate cleanup)
  acknowledgeModeratedContributions: protectedProcedure
    .input(z.object({
      overlayIds: z.array(z.uuid()).min(1).max(50) // AI : Limit to 50 items at once
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user?.id;
        if (!userId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Must be logged in' });
        }

        // AI : Verify all overlays belong to user and are rejected/replaced
        const overlaysToDelete = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            status: overlays.status,
            authorId: overlays.authorId
          })
          .from(overlays)
          .where(sql`${overlays.id} IN (${sql.join(input.overlayIds.map(id => sql`${id}`), sql`, `)})`);

        // AI : Validate ownership and status
        for (const overlay of overlaysToDelete) {
          if (overlay.authorId !== userId) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to delete these overlays' });
          }
          if (overlay.status !== 'rejected' && overlay.status !== 'replaced') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Can only acknowledge rejected/replaced overlays' });
          }
        }

        // AI : Delete images immediately (thumbnails only, fullsize already deleted)
        for (const overlay of overlaysToDelete) {
          try {
            await deleteLocalImages(overlay.filename, 'thumbnail');
          } catch (imageError) {
            console.error(`Failed to delete thumbnail for overlay ${overlay.id}:`, imageError);
            // AI : Continue with DB deletion even if image deletion fails
          }
        }

        // AI : Delete from database
        await db.delete(overlays).where(
          sql`${overlays.id} IN (${sql.join(input.overlayIds.map(id => sql`${id}`), sql`, `)})`
        );

        return { success: true, deletedCount: overlaysToDelete.length };
      } catch (error) {
        console.error('Error acknowledging moderated contributions:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to acknowledge moderated contributions' });
      }
    }),
});
