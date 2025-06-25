import { db } from '../db';
import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, cities, overlays } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

const publishProjectSchema = z.object({
  id: z.string().min(1).max(36), // AI : UUID length limit
  title: z.string().min(1).max(200), // AI : Reasonable title length limit
  description: z.string().max(2000).optional(), // AI : Limit description to 2000 characters
  cityId: z.string().uuid().optional(), // AI : City ID for foreign key relationship
  metadata: z.object({
    // AI : Only allow startDate, endDate, and sourceUrl in metadata - nothing else
    startDate: z.string().max(50).optional(), // AI: ISO date string for project start
    endDate: z.string().max(50).optional(), // AI: ISO date string for project end
    sourceUrl: z.string().url().max(500).optional() // AI : Validate URL format and limit length
  }).optional()
});

export const projectRouter = router({
  publishProject: publicProcedure
    .input(publishProjectSchema)
    .mutation(async ({ input }) => {
      try {
        // AI : Log received data
        console.log('=== PUBLISH PROJECT BACKEND ===');
        console.log('Received input:', JSON.stringify(input, null, 2));

        // AI: Check if project already exists
        const existingProject = await db.select()
          .from(projects)
          .where(eq(projects.id, input.id))
          .limit(1);
        if (existingProject.length > 0) {
          // AI : Update existing project
          const updateResult = await db
            .update(projects)
            .set({
              title: input.title,
              description: input.description,
              cityId: input.cityId || null, // AI : Set cityId or null if not provided
              metadata: input.metadata,
              updatedAt: new Date()
            })
            .where(eq(projects.id, input.id))
            .returning();

          console.log('Updated existing project:', updateResult[0]);
          return { success: true, id: updateResult[0].id, exists: true };
        }

        // AI: Insert new project into database
        const result = await db.insert(projects).values({
          id: input.id,
          title: input.title,
          description: input.description,
          cityId: input.cityId || null, // AI : Set cityId or null if not provided
          metadata: input.metadata
        }).returning();

        console.log('Created new project:', result[0]);
        return { success: true, id: result[0].id, exists: false };
      } catch (error) {
        console.error('Error publishing project:', error);
        throw new Error('Failed to publish project');
      }
    }),
  getAllProjects: publicProcedure
    .query(async () => {
      try {
        console.log('AI : Fetching all projects from backend database with city information');

        // AI : Join projects with cities to include city information
        const allProjects = await db
          .select({
            id: projects.id,
            title: projects.title,
            description: projects.description,
            ownerId: projects.ownerId,
            cityId: projects.cityId,
            metadata: projects.metadata,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
            // AI : Include city information when available
            city: {
              id: cities.id,
              name: cities.name,
              countryCode: cities.countryCode,
              lat: sql<number>`ST_Y(${cities.coordinates})`,
              lng: sql<number>`ST_X(${cities.coordinates})`
            }
          })
          .from(projects)
          .leftJoin(cities, eq(projects.cityId, cities.id));        console.log(`AI : Found ${allProjects.length} projects in backend with city data`);
        return { projects: allProjects };
      } catch (error) {
        console.error('Error fetching all projects:', error);
        throw new Error('Failed to fetch projects');
      }
    }),

  // AI : Get projects with overlays within 10km of camera center
  getProjectsNearLocation: publicProcedure
    .input(z.object({
      lat: z.number(),
      lng: z.number(),
      radiusKm: z.number().default(10)
    }))
    .query(async ({ input }) => {
      try {
        const { lat, lng, radiusKm } = input;
        console.log(`AI : Fetching projects with overlays within ${radiusKm}km of ${lat}, ${lng}`);

        // AI : Find projects that have at least one overlay within the specified radius
        const nearbyProjects = await db
          .select({
            id: projects.id,
            title: projects.title,
            description: projects.description,
            ownerId: projects.ownerId,
            cityId: projects.cityId,
            metadata: projects.metadata,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
            // AI : Include city information when available
            city: {
              id: cities.id,
              name: cities.name,
              countryCode: cities.countryCode,
              lat: sql<number>`ST_Y(${cities.coordinates})`,
              lng: sql<number>`ST_X(${cities.coordinates})`
            }
          })
          .from(projects)
          .leftJoin(cities, eq(projects.cityId, cities.id))
          .innerJoin(overlays, eq(overlays.projectId, projects.id))
          .where(
            sql`ST_DWithin(
              ${overlays.centroid},
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              ${radiusKm * 1000}
            )`
          )
          .groupBy(
            projects.id,
            projects.title,
            projects.description,
            projects.ownerId,
            projects.cityId,
            projects.metadata,
            projects.createdAt,
            projects.updatedAt,
            cities.id,
            cities.name,
            cities.countryCode,
            cities.coordinates
          );

        console.log(`AI : Found ${nearbyProjects.length} projects with overlays near location`);
        return { projects: nearbyProjects };
      } catch (error) {
        console.error('Error fetching nearby projects:', error);
        throw new Error('Failed to fetch nearby projects');
      }
    })
});
