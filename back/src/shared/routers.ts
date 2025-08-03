import { router } from '../trpc';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { createProjectRouter } from '../routes/project';
import { createOverlayRouter } from '../routes/overlay';
import { createCitiesRouter } from '../routes/cities';
import { createCountriesRouter } from '../routes/countries';
import { createModerationRouter } from '../routes/moderation';

// AI : Main router factory that combines all sub-routers
export function createAppRouter(db: PostgresJsDatabase<typeof schema>) {
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
export type AppRouter = ReturnType<typeof createAppRouter>;
