import { db } from '../db';
import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { overlays, projects, cities } from '../db/schema';
import { sql, eq } from 'drizzle-orm';

const publishOverlaySchema = z.object({
  id: z.string().min(1).max(36), // AI : UUID length limit
  filename: z.string().min(1).max(255), // AI : Standard filename length limit
  caption: z.string().max(500).optional(), // AI : Limit caption to 500 characters
  projectId: z.string().min(1).max(36), // AI : UUID length limit for project reference
  replacesOverlayId: z.string().min(1).max(36).optional(), // AI : UUID for overlay replacement
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
  projectName: projects.title,
  cityName: cities.name,
};

// AI : Calculate bounding box from overlay corners
function calculateBoundingBox(overlay: any) {
  const latitudes = [overlay.topLeftLat, overlay.topRightLat, overlay.bottomRightLat, overlay.bottomLeftLat];
  const longitudes = [overlay.topLeftLng, overlay.topRightLng, overlay.bottomRightLng, overlay.bottomLeftLng];
  
  return {
    minLat: Math.min(...latitudes),
    maxLat: Math.max(...latitudes),
    minLng: Math.min(...longitudes),
    maxLng: Math.max(...longitudes)
  };
}

// AI : Base query builder for overlays with joins
function buildOverlayQuery() {
  return db
    .select(overlaySelectFields)
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .leftJoin(cities, eq(projects.cityId, cities.id));
}

// AI : Find overlays that intersect with a given bounding box
async function findIntersectingOverlays(excludeId: string, boundingBox: ReturnType<typeof calculateBoundingBox>) {
  // AI : Get all overlays except the excluded one
  const allOverlays = await buildOverlayQuery()
    .where(sql`${overlays.id} != ${excludeId}`);

  // AI : Filter overlays that have bounding box overlap
  return allOverlays.filter(overlay => {
    const overlayBoundingBox = calculateBoundingBox(overlay);
    
    // AI : Two bounding boxes overlap if they overlap in both dimensions
    const latOverlap = boundingBox.minLat <= overlayBoundingBox.maxLat && boundingBox.maxLat >= overlayBoundingBox.minLat;
    const lngOverlap = boundingBox.minLng <= overlayBoundingBox.maxLng && boundingBox.maxLng >= overlayBoundingBox.minLng;
    
    return latOverlap && lngOverlap;
  });
}

export const overlayRouter = router({
  getOverlay: publicProcedure
    .input(getOverlaySchema)
    .query(async ({ input }) => {
      console.log('Fetching overlay with input:', input);
      try {
        // AI : Fetch the requested overlay
        const overlay = await buildOverlayQuery()
          .where(eq(overlays.id, input.id))
          .limit(1);

        if (!overlay.length) {
          throw new Error('Overlay not found');
        }

        let intersectingOverlays: any[] = [];

        // AI : If includeIntersecting is true, find overlays that intersect with the queried overlay's bounding box
        if (input.includeIntersecting) {
          const queriedOverlay = overlay[0];
          const boundingBox = calculateBoundingBox(queriedOverlay);

          intersectingOverlays = await findIntersectingOverlays(input.id, boundingBox);
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
        const centroidLng = input.corners.reduce((sum, corner) => sum + corner.lng, 0) / 4;

        // AI : Prepare overlay data for insert/update
        const overlayData = {
          caption: input.caption,
          projectId: input.projectId,
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

        // AI : Check if overlay with this filename already exists (UPSERT logic)
        const existingOverlay = await db
          .select()
          .from(overlays)
          .where(sql`filename = ${input.filename}`)
          .limit(1);

        if (existingOverlay.length > 0) {
          // AI : Update existing overlay
          const result = await db
            .update(overlays)
            .set({
              ...overlayData,
              updatedAt: sql`NOW()`
            })
            .where(sql`filename = ${input.filename}`)
            .returning();

          return {
            success: true,
            id: result[0].id,
            exists: true // AI : Indicate this overlay was updated
          };
        } else {
          // AI : Insert new overlay
          const result = await db.insert(overlays).values({
            filename: input.filename,
            ...overlayData
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