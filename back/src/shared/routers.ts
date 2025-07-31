import { router } from '../trpc';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

// AI : Main router factory that combines all sub-routers
export async function createAppRouter(db: PostgresJsDatabase<typeof schema>) {
  // AI : Import existing router factories using dynamic imports
  const [
    { createProjectRouter },
    { createOverlayRouter },
    { createCitiesRouter },
    { createCountriesRouter },
    { createModerationRouter }
  ] = await Promise.all([
    import('../routes/project'),
    import('../routes/overlay'),
    import('../routes/cities'),
    import('../routes/countries'),
    import('../routes/moderation')
  ]);

  // AI : Return the full router with all routes, passing database to each factory
  return router({
    project: createProjectRouter(db),
    moderation: createModerationRouter(db),
    cities: createCitiesRouter(db),
    country: createCountriesRouter(db),
    overlay: createOverlayRouter(db),
  });
}

// AI : Export types
export type AppRouter = Awaited<ReturnType<typeof createAppRouter>>;
