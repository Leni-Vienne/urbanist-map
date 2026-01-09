import { router } from "../trpc";
import { projectRouter } from "./project";
import { overlayRouter } from "./overlay";
import { citiesRouter } from "./cities";
import { countriesRouter } from "./countries";
import { moderationRouter } from "./moderation";
import { changesRouter } from "./changes";
import { authRouter } from "./auth";
import { adminRouter } from "./admin";

// AI : Main router that combines all sub-routers
export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  moderation: moderationRouter,
  cities: citiesRouter,
  country: countriesRouter,
  overlay: overlayRouter,
  changes: changesRouter,
  admin: adminRouter,
});

// AI : Export types
export type AppRouter = typeof appRouter;
