import { publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, overlays, cities, countries, approvalStatusEnum } from '../db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

// AI : Factory functions to create all routers with database injection

// AI : Project Router Factory
export function createProjectRouter(db: PostgresJsDatabase<typeof schema>) {
  const publishProjectSchema = z.object({
    id: z.string().uuid().optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    cityId: z.string().uuid().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    sourceUrl: z.string().url().optional(),
    latestUpdateOn: z.string().optional()
  });

  return router({
    publishProject: publicProcedure
      .input(publishProjectSchema)
      .mutation(async ({ input }) => {
        try {
          const [newProject] = await db
            .insert(projects)
            .values({
              id: input.id,
              title: input.title,
              description: input.description,
              cityId: input.cityId,
              startDate: input.startDate ? new Date(input.startDate) : undefined,
              endDate: input.endDate ? new Date(input.endDate) : undefined,
              sourceUrl: input.sourceUrl,
              latestUpdateOn: input.latestUpdateOn ? new Date(input.latestUpdateOn) : undefined,
              createdAt: new Date(),
              updatedAt: new Date()
            })
            .returning();

          return newProject;
        } catch (error) {
          console.error('Error creating project:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create project',
          });
        }
      }),

    // AI : Add more project procedures as needed
  });
}

// AI : Moderation Router Factory
export function createModerationRouter(db: PostgresJsDatabase<typeof schema>) {
  const setApprovalStatusSchema = z.object({
    ids: z.array(z.string().uuid()),
    status: z.enum(approvalStatusEnum.enumValues),
  });

  return router({
    getPendingSubmissions: publicProcedure
      .query(async () => {
        try {
          const pendingProjects = await db
            .select()
            .from(projects)
            .where(eq(projects.status, 'pending'));

          const pendingOverlays = await db
            .select({
              id: overlays.id,
              name: sql<string>`coalesce(${overlays.caption}, 'Unnamed')`,
              city: cities.name,
            })
            .from(overlays)
            .leftJoin(projects, eq(overlays.projectId, projects.id))
            .leftJoin(cities, eq(projects.cityId, cities.id))
            .where(eq(overlays.status, 'pending'));

          return {
            projects: pendingProjects,
            overlays: pendingOverlays,
          };
        } catch (error) {
          console.error('Error fetching pending submissions:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to fetch pending submissions',
          });
        }
      }),

    setApprovalStatus: publicProcedure
      .input(setApprovalStatusSchema)
      .mutation(async ({ input }) => {
        try {
          // AI : Update projects
          await db
            .update(projects)
            .set({ status: input.status })
            .where(inArray(projects.id, input.ids));

          // AI : Update overlays
          await db
            .update(overlays)
            .set({ status: input.status })
            .where(inArray(overlays.id, input.ids));

          return { success: true };
        } catch (error) {
          console.error('Error updating approval status:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to update approval status',
          });
        }
      }),
  });
}

// AI : Cities Router Factory
export function createCitiesRouter(db: PostgresJsDatabase<typeof schema>) {
  return router({
    // AI : Add cities procedures as needed
    getAll: publicProcedure
      .query(async () => {
        try {
          return await db.select().from(cities);
        } catch (error) {
          console.error('Error fetching cities:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to fetch cities',
          });
        }
      }),
  });
}

// AI : Countries Router Factory
export function createCountriesRouter(db: PostgresJsDatabase<typeof schema>) {
  return router({
    // AI : Add countries procedures as needed
    getAll: publicProcedure
      .query(async () => {
        try {
          return await db.select().from(countries);
        } catch (error) {
          console.error('Error fetching countries:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to fetch countries',
          });
        }
      }),
  });
}

// AI : Overlay Router Factory (no database dependency)
export function createOverlayRouter() {
  return router({
    // AI : Simple overlay operations that don't need database
    getConfig: publicProcedure
      .query(() => {
        return { version: '1.0', features: ['upload', 'transform'] };
      }),
  });
}

// AI : Main router factory that combines all sub-routers
export function createAppRouter(db?: PostgresJsDatabase<typeof schema>) {
  if (!db) {
    // AI : If no database, return minimal router
    return router({
      overlay: createOverlayRouter(),
    });
  }

  // AI : Full router with database
  return router({
    project: createProjectRouter(db),
    moderation: createModerationRouter(db),
    cities: createCitiesRouter(db),
    countries: createCountriesRouter(db),
    overlay: createOverlayRouter(),
  });
}

// AI : Export types
export type AppRouter = ReturnType<typeof createAppRouter>;
export type ProjectRouter = ReturnType<typeof createProjectRouter>;
export type ModerationRouter = ReturnType<typeof createModerationRouter>;
