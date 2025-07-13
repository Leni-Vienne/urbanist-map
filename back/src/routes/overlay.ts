import { db } from '../db';
import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { overlays, projects, cities } from '../db/schema';
import { sql, eq, and } from 'drizzle-orm';

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

const getOverlaySchema = z.object({
  id: z.string().uuid(),
  includeIntersecting: z.boolean().optional().default(false),
});

export const overlayRouter = router({
  getOverlay: publicProcedure
    .input(getOverlaySchema)
    .query(async ({ input }) => {
      console.log('Fetching overlay with input:', input);
      try {
        // AI : Fetch the requested overlay
        const overlay = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            caption: overlays.caption,
            status: overlays.status,
            projectId: overlays.projectId,
            authorId: overlays.authorId,
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
            // AI : Join project and city information
            projectName: projects.title,
            cityName: cities.name,
          })
          .from(overlays)
          .leftJoin(projects, eq(overlays.projectId, projects.id))
          .leftJoin(cities, eq(projects.cityId, cities.id))
          .where(eq(overlays.id, input.id))
          .limit(1);

        if (!overlay.length) {
          throw new Error('Overlay not found');
        }

        let intersectingOverlays: any[] = [];

        // AI : If includeIntersecting is true, find overlays that intersect with the queried overlay's bounding box
        if (input.includeIntersecting) {
          const queriedOverlay = overlay[0];
          
          // AI : Create bounding box of the queried overlay using its 4 corners
          const queriedMinLat = Math.min(
            queriedOverlay.topLeftLat, 
            queriedOverlay.topRightLat, 
            queriedOverlay.bottomRightLat, 
            queriedOverlay.bottomLeftLat
          );
          const queriedMaxLat = Math.max(
            queriedOverlay.topLeftLat, 
            queriedOverlay.topRightLat, 
            queriedOverlay.bottomRightLat, 
            queriedOverlay.bottomLeftLat
          );
          const queriedMinLng = Math.min(
            queriedOverlay.topLeftLng, 
            queriedOverlay.topRightLng, 
            queriedOverlay.bottomRightLng, 
            queriedOverlay.bottomLeftLng
          );
          const queriedMaxLng = Math.max(
            queriedOverlay.topLeftLng, 
            queriedOverlay.topRightLng, 
            queriedOverlay.bottomRightLng, 
            queriedOverlay.bottomLeftLng
          );

          console.log('Queried overlay bounding box:', {
            minLat: queriedMinLat,
            maxLat: queriedMaxLat,
            minLng: queriedMinLng,
            maxLng: queriedMaxLng
          });

          // AI : Find overlays that intersect with the queried overlay's bounding box
          intersectingOverlays = await db
            .select({
              id: overlays.id,
              filename: overlays.filename,
              caption: overlays.caption,
              status: overlays.status,
              projectId: overlays.projectId,
              authorId: overlays.authorId,
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
              projectName: projects.title,
              cityName: cities.name,
            })
            .from(overlays)
            .leftJoin(projects, eq(overlays.projectId, projects.id))
            .leftJoin(cities, eq(projects.cityId, cities.id))
            .where(
              and(
                // AI : Exclude the requested overlay itself
                sql`${overlays.id} != ${input.id}`,
                // AI : Check bounding box intersection: two bounding boxes intersect if they overlap in both dimensions
                sql`NOT (
                  GREATEST(${overlays.topLeftLat}, ${overlays.topRightLat}, ${overlays.bottomRightLat}, ${overlays.bottomLeftLat}) < ${queriedMinLat} OR
                  LEAST(${overlays.topLeftLat}, ${overlays.topRightLat}, ${overlays.bottomRightLat}, ${overlays.bottomLeftLat}) > ${queriedMaxLat} OR
                  GREATEST(${overlays.topLeftLng}, ${overlays.topRightLng}, ${overlays.bottomRightLng}, ${overlays.bottomLeftLng}) < ${queriedMinLng} OR
                  LEAST(${overlays.topLeftLng}, ${overlays.topRightLng}, ${overlays.bottomRightLng}, ${overlays.bottomLeftLng}) > ${queriedMaxLng}
                )`
              )
            );
            
          console.log(`Found ${intersectingOverlays.length} intersecting overlays`);
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