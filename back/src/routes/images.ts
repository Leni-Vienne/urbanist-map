import { db } from '../db';
import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { images } from '../db/schema';
import { sql } from 'drizzle-orm';

const publishOverlaySchema = z.object({
  id: z.string(),
  filename: z.string(),
  caption: z.string().optional(),
  projectId: z.string(),
  metadata: z.any().optional(),
  corners: z.array(z.object({
    lat: z.number(),
    lng: z.number()
  })).length(4)
});

export const imagesRouter = router({
  publishOverlay: publicProcedure
    .input(publishOverlaySchema)
    .mutation(async ({ input }) => {
      try {
        // AI : Extract corner coordinates
        const [topLeft, topRight, bottomRight, bottomLeft] = input.corners;
        
        // AI : Calculate centroid (center point)
        const centroidLat = input.corners.reduce((sum, corner) => sum + corner.lat, 0) / 4;
        const centroidLng = input.corners.reduce((sum, corner) => sum + corner.lng, 0) / 4;        // AI : Insert overlay into database
        const result = await db.insert(images).values({
          filename: input.filename,
          caption: input.caption,
          projectId: input.projectId,
          metadata: input.metadata,
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

        return { success: true, id: result[0].id };
      } catch (error) {
        console.error('Error publishing overlay:', error);
        throw new Error('Failed to publish overlay');
      }
    })
})