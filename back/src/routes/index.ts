import { router } from "../trpc";
import { projectRouter } from "./project";
import { overlayRouter } from "./overlay";
import { citiesRouter } from "./cities";
import { countriesRouter } from "./countries";
import { moderationRouter } from "./moderation";
import { changesRouter } from "./changes";
import { accountRouter } from "./account";
import { adminRouter } from "./admin";
import { viewportRouter } from "./viewport";
import { feedRouter } from "./feed";

export const appRouter = router({
  account: accountRouter,
  project: projectRouter,
  moderation: moderationRouter,
  cities: citiesRouter,
  country: countriesRouter,
  overlay: overlayRouter,
  changes: changesRouter,
  admin: adminRouter,
  viewport: viewportRouter,
  feed: feedRouter,
});

export type AppRouter = typeof appRouter;
