import { db } from '../db';
import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { overlays, projects, cities } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

const publishOverlaySchema = z.object({
  id: z.string().min(1).max(36), // AI : UUID length limit
  filename: z.string().min(1).max(255), // AI : Standard filename length limit
  caption: z.string().max(500).optional(), // AI : Limit caption to 500 characters
  projectId: z.string().min(1).max(36), // AI : UUID length limit for project reference
  metadata: z.any().optional(),
  corners: z.array(z.object({
    lat: z.number().min(-90).max(90), // AI : Valid latitude range
    lng: z.number().min(-180).max(180) // AI : Valid longitude range
  })).length(4) // AI : Exactly 4 corners required
});

const boundsSchema = z.object({
  north: z.number().min(-90).max(90), // AI : Valid latitude range
  south: z.number().min(-90).max(90), // AI : Valid latitude range  
  east: z.number().min(-180).max(180), // AI : Valid longitude range
  west: z.number().min(-180).max(180) // AI : Valid longitude range
}).refine(data => data.north > data.south, {
  message: "AI : North boundary must be greater than south boundary"
}).refine(data => data.east > data.west, {
  message: "AI : East boundary must be greater than west boundary"
});

export const overlayRouter = router({
  publishOverlay: publicProcedure
    .input(publishOverlaySchema)
    .mutation(async ({ input }) => {
      try {
        // AI : Extract corner coordinates
        const [topLeft, topRight, bottomRight, bottomLeft] = input.corners;

        // AI : Calculate centroid (center point)
        const centroidLat = input.corners.reduce((sum, corner) => sum + corner.lat, 0) / 4;
        const centroidLng = input.corners.reduce((sum, corner) => sum + corner.lng, 0) / 4;        // AI : Check if overlay with this filename already exists (UPSERT logic)
        const existingOverlay = await db
          .select()
          .from(overlays)
          .where(sql`filename = ${input.filename}`)
          .limit(1); if (existingOverlay.length > 0) {          // AI : Update existing overlay
            const result = await db
              .update(overlays)
              .set({
                caption: input.caption,
                projectId: input.projectId,
                metadata: null, // AI : Keep metadata empty as requested
                topLeftLat: topLeft.lat,
                topLeftLng: topLeft.lng,
                topRightLat: topRight.lat,
                topRightLng: topRight.lng,
                bottomRightLat: bottomRight.lat,
                bottomRightLng: bottomRight.lng,
                bottomLeftLat: bottomLeft.lat,
                bottomLeftLng: bottomLeft.lng,
                centroid: sql`ST_SetSRID(ST_MakePoint(${centroidLng}, ${centroidLat}), 4326)`,
                updatedAt: sql`NOW()`
              }).where(sql`filename = ${input.filename}`)
              .returning();

            return {
              success: true,
              id: result[0].id,
              exists: true // AI : Indicate this overlay was updated
            };
          } else {          // AI : Insert new overlay
          const result = await db.insert(overlays).values({
            filename: input.filename,
            caption: input.caption,
            projectId: input.projectId,
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
          }).returning();

          return {
            success: true,
            id: result[0].id,
            exists: false // AI : Indicate this is a new overlay
          };
        }
      } catch (error) {
        console.error('Error publishing overlay:', error);
        throw new Error('Failed to publish overlay');
      }
    }),
});