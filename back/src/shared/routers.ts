import { publicProcedure, router } from '../trpc';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

// AI : Main router factory that combines all sub-routers
export async function createAppRouter(db?: PostgresJsDatabase<typeof schema>) {
  if (!db) {
    // AI : If no database, return minimal router with helpful info
    return router({
      overlay: router({
        getConfig: publicProcedure
          .query(() => {
            return { 
              version: '1.0', 
              features: ['upload', 'transform'], 
              status: 'Database not connected. Please configure your DATABASE_URL.' 
            };
          }),
      }),
      country: router({
        getCountriesWithProjects: publicProcedure
          .query(() => {
            throw new Error('Database not connected. Please configure your DATABASE_URL in .dev.vars file.');
          }),
      }),
    });
  }

  // AI : Set the global database for existing route files
  (globalThis as any).__workersDb = db;

  try {
    // AI : Import existing routers using dynamic imports
    const [projectModule, overlayModule, citiesModule, countriesModule, moderationModule] = await Promise.all([
      import('../routes/project'),
      import('../routes/overlay'),
      import('../routes/cities'),
      import('../routes/countries'),
      import('../routes/moderation')
    ]);

    // AI : Full router with database
    return router({
      project: projectModule.projectRouter,
      moderation: moderationModule.moderationRouter,
      cities: citiesModule.citiesRouter,
      country: countriesModule.countriesRouter,
      overlay: overlayModule.overlayRouter,
    });
  } catch (error) {
    console.error('AI : Error importing route modules:', error);
    // AI : Return minimal router if imports fail
    return router({
      overlay: router({
        getConfig: publicProcedure
          .query(() => {
            return { version: '1.0', features: ['upload', 'transform'], error: 'Routes failed to load' };
          }),
      }),
    });
  }
}

// AI : Export types
export type AppRouter = Awaited<ReturnType<typeof createAppRouter>>;
