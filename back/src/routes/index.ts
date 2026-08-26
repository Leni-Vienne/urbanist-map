import { router } from "../trpc";
import { projectRouter } from "./project";
import { overlayRouter } from "./overlay";
import { boundariesRouter } from "./boundaries";
import { countriesRouter } from "./countries";
import { moderationRouter } from "./moderation/index";
import { changesRouter } from "./changes";
import { accountRouter } from "./account";
import { adminRouter } from "./admin";
import { viewportRouter } from "./viewport";
import { feedRouter } from "./feed";
import { submissionRouter } from "./submission";

export const appRouter = router({
  account: accountRouter,
  project: projectRouter,
  moderation: moderationRouter,
  boundaries: boundariesRouter,
  country: countriesRouter,
  overlay: overlayRouter,
  changes: changesRouter,
  admin: adminRouter,
  viewport: viewportRouter,
  feed: feedRouter,
  submission: submissionRouter,
});

export type AppRouter = typeof appRouter;
