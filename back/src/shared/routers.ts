import { router } from '../trpc';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

// AI : Main router factory that combines all sub-routers
export async function createAppRouter(db: PostgresJsDatabase<typeof schema>) {
  // AI : Set the global database for existing route files
  (globalThis as any).__workersDb = db;

  // AI : Import existing routers using dynamic imports
  const [projectModule, overlayModule, citiesModule, countriesModule, moderationModule] = await Promise.all([
    import('../routes/project'),
    import('../routes/overlay'),
    import('../routes/cities'),
    import('../routes/countries'),
    import('../routes/moderation')
  ]);

  // AI : Return the full router with all routes
  return router({
    project: projectModule.projectRouter,
    moderation: moderationModule.moderationRouter,
    cities: citiesModule.citiesRouter,
    country: countriesModule.countriesRouter,
    overlay: overlayModule.overlayRouter,
  });
}

// AI : Export types
export type AppRouter = Awaited<ReturnType<typeof createAppRouter>>;
