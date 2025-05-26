import { db } from '../db';
import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects } from '../db/schema';
import { eq } from 'drizzle-orm';

const publishProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  metadata: z.object({
    location: z.string().optional(),
    startDate: z.string().optional(), // AI: ISO date string
    endDate: z.string().optional(), // AI: ISO date string
    sourceUrl: z.string().optional(),
    overlayIds: z.array(z.string()),
    color: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  }).optional()
});

export const projectsRouter = router({
  publishProject: publicProcedure
    .input(publishProjectSchema)
    .mutation(async ({ input }) => {
      try {
        // AI: Check if project already exists
        const existingProject = await db.select()
          .from(projects)
          .where(eq(projects.id, input.id))
          .limit(1);

        if (existingProject.length > 0) {
          return { success: true, id: input.id, exists: true };
        }

        // AI: Insert new project into database
        const result = await db.insert(projects).values({
          id: input.id,
          title: input.title,
          description: input.description,
          metadata: input.metadata
        }).returning();

        return { success: true, id: result[0].id, exists: false };
      } catch (error) {
        console.error('Error publishing project:', error);
        throw new Error('Failed to publish project');
      }
    })
});
