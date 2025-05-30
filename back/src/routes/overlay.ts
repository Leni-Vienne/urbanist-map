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

const boundsSchema = z.object({
  north: z.number(),
  south: z.number(),
  east: z.number(),
  west: z.number()
});

export const overlayRouter = router({  publishOverlay: publicProcedure
    .input(publishOverlaySchema)
    .mutation(async ({ input }) => {
      try {
        // AI : Log received data
        console.log('=== PUBLISH OVERLAY BACKEND ===');
        console.log('Received input:', JSON.stringify(input, null, 2));
        
        // AI : Extract corner coordinates
        const [topLeft, topRight, bottomRight, bottomLeft] = input.corners;

        // AI : Calculate centroid (center point)
        const centroidLat = input.corners.reduce((sum, corner) => sum + corner.lat, 0) / 4;
        const centroidLng = input.corners.reduce((sum, corner) => sum + corner.lng, 0) / 4;        // AI : Check if overlay with this filename already exists (UPSERT logic)
        console.log('Checking for existing overlay with filename:', input.filename);
        const existingOverlay = await db
          .select()
          .from(images)
          .where(sql`filename = ${input.filename}`)
          .limit(1);

        console.log('Existing overlay found:', existingOverlay.length > 0, existingOverlay);

        if (existingOverlay.length > 0) {
          // AI : Update existing overlay
          console.log('Updating existing overlay');
          const result = await db
            .update(images)
            .set({
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
              centroid: sql`ST_SetSRID(ST_MakePoint(${centroidLng}, ${centroidLat}), 4326)`,
              updatedAt: sql`NOW()`
            })            .where(sql`filename = ${input.filename}`)
            .returning();

          console.log('Update result:', result);
          return { 
            success: true, 
            id: result[0].id,
            exists: true // AI : Indicate this overlay was updated
          };
        } else {
          // AI : Insert new overlay
          console.log('Creating new overlay');
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
            bottomLeftLng: bottomLeft.lng,            centroid: sql`ST_SetSRID(ST_MakePoint(${centroidLng}, ${centroidLat}), 4326)`
          }).returning();

          console.log('Insert result:', result);
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
  getIntersectingOverlays: publicProcedure
    .input(boundsSchema)
    .query(async ({ input }) => {
      try {
        // AI : Create a bounding box polygon from the input bounds
        const boundingBox = sql`ST_MakeEnvelope(${input.west}, ${input.south}, ${input.east}, ${input.north}, 4326)`;

        // AI : Calculate center point of the bounds for distance calculation
        const centerLat = (input.north + input.south) / 2;
        const centerLng = (input.east + input.west) / 2;
        const centerPoint = sql`ST_SetSRID(ST_MakePoint(${centerLng}, ${centerLat}), 4326)`;        // AI : Query overlays where centroid is within the bounding box using spatial index
        const overlays = await db
          .select({
            id: images.id,
            filename: images.filename,
            phase: images.caption,
            sequenceNumber: images.metadata,
            centroidLat: sql<number>`ST_Y(${images.centroid})`.as('centroid_lat'),
            centroidLng: sql<number>`ST_X(${images.centroid})`.as('centroid_lng'),
            // AI : Include all corner coordinates for frontend overlay positioning
            topLeftLat: images.topLeftLat,
            topLeftLng: images.topLeftLng,
            topRightLat: images.topRightLat,
            topRightLng: images.topRightLng,
            bottomRightLat: images.bottomRightLat,
            bottomRightLng: images.bottomRightLng,
            bottomLeftLat: images.bottomLeftLat,
            bottomLeftLng: images.bottomLeftLng,
            distance: sql<number>`ST_Distance(${images.centroid}, ${centerPoint})`.as('distance'),
            createdAt: images.createdAt
          })
          .from(images)
          .where(sql`ST_Within(${images.centroid}, ${boundingBox})`)
          .orderBy(sql`distance`);

        // AI : Transform results for CDN usage
        const result = overlays.map(overlay => ({
          id: overlay.id,
          filename: overlay.filename, // AI : For CDN URL construction
          phase: overlay.phase || undefined, // AI : Make it optional
          sequenceNumber: overlay.sequenceNumber ? (overlay.sequenceNumber as any)?.sequenceNumber || null : null,
          centroid: {
            lat: overlay.centroidLat,
            lng: overlay.centroidLng
          },
          // AI : Include all corner coordinates for proper overlay positioning
          corners: [
            { lat: overlay.topLeftLat, lng: overlay.topLeftLng },
            { lat: overlay.topRightLat, lng: overlay.topRightLng },
            { lat: overlay.bottomRightLat, lng: overlay.bottomRightLng },
            { lat: overlay.bottomLeftLat, lng: overlay.bottomLeftLng }
          ],
          distance: overlay.distance,
          createdAt: overlay.createdAt
        }));

        return { overlays: result };
      } catch (error) {
        console.error('Error fetching intersecting overlays:', error);
        throw new Error('Failed to fetch intersecting overlays');
      }
    })
});