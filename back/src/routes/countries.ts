import { publicProcedure, router } from '../trpc';
import { countries, cities, projects } from '../db/schema';
import { eq, exists, and, inArray } from 'drizzle-orm';
import { db } from '../database';
import * as z from 'zod';
import {
  getUserOverlayChangeRequestIds,
  buildProjectVisibilityCondition,
  buildProjectHasVisibleContentCondition,
  type ApprovalStatus
} from '../db/visibilityHelpers';

export const countriesRouter = router({
  // AI : Get all countries that have at least one city with a visible project
  getCountriesWithProjects: publicProcedure
    .input(z.object({
      viewMode: z.boolean().optional().default(true), // AI : true for view mode (approved only), false for edit mode (include user's own)
      includeStatus: z.array(z.enum(['pending', 'approved', 'rejected'])).optional(), // AI : Optional status filter for admins (overrides viewMode)
    }).optional())
    .query(async ({ input, ctx }) => {
      try {
        const viewMode = input?.viewMode ?? true;

        // AI : Fetch user's overlay change request IDs if in edit mode
        const overlayChangeRequestIds = ctx.user && !viewMode
          ? await getUserOverlayChangeRequestIds(db, ctx.user.id)
          : undefined;

        // AI : Build visibility conditions using helper functions
        // AI : Admin includeStatus filter overrides normal viewMode logic
        let projectCondition;
        if (input?.includeStatus && ctx.user?.role === 'admin' && input.includeStatus.length > 0) {
          projectCondition = inArray(projects.status, input.includeStatus as ApprovalStatus[]);
        } else {
          projectCondition = buildProjectVisibilityCondition(ctx.user, viewMode);
        }

        return await db
          .select({
            id: countries.id,
            code: countries.code,
            name: countries.name,
            centerCoordinates: countries.centerCoordinates
          })
          .from(countries)
          .where(
            exists(
              db
                .select()
                .from(cities)
                .innerJoin(projects, eq(projects.cityId, cities.id))
                .where(and(
                  eq(cities.countryCode, countries.code),
                  projectCondition,
                  buildProjectHasVisibleContentCondition(ctx.user, viewMode, overlayChangeRequestIds)
                ))
            )
          )
          .orderBy(countries.name);
      } catch (error) {
        console.error('Error fetching countries with projects:', error);
        throw new Error('Failed to fetch countries with projects');
      }
    })
});
