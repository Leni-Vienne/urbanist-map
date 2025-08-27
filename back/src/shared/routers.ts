import { router } from '../trpc';
import { projectRouter } from '../routes/project';
import { overlayRouter } from '../routes/overlay';
import { citiesRouter } from '../routes/cities';
import { countriesRouter } from '../routes/countries';
import { moderationRouter } from '../routes/moderation';
import { changesRouter } from '../routes/changes';
import { authRouter } from '../routes/auth';

// AI : Main router that combines all sub-routers
export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  moderation: moderationRouter,
  cities: citiesRouter,
  country: countriesRouter,
  overlay: overlayRouter,
  changes: changesRouter,
});

// AI : Export types
export type AppRouter = typeof appRouter;
