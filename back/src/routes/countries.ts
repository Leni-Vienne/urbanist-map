import { publicProcedure, router } from '../trpc';
import { countries, cities, projects } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../database';
import * as z from 'zod';
import {
  getUserOverlayChangeRequestIds,
  buildProjectVisibilityCondition,
  buildProjectHasVisibleContentCondition,
  type ApprovalStatus
} from '../db/visibilityHelpers';

export const countriesRouter = router({
  getCountriesWithProjects: publicProcedure
    .input(z.object({
      viewMode: z.boolean().optional().default(true),
      includeStatus: z.array(z.enum(['pending', 'approved', 'rejected'])).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      try {
        const viewMode = input?.viewMode ?? true;

        const overlayChangeRequestIds = ctx.user && !viewMode
          ? await getUserOverlayChangeRequestIds(db, ctx.user.id)
          : undefined;

        let projectCondition;
        if (input?.includeStatus && ctx.user?.role === 'admin' && input.includeStatus.length > 0) {
          projectCondition = inArray(projects.status, input.includeStatus as ApprovalStatus[]);
        } else {
          projectCondition = buildProjectVisibilityCondition(ctx.user, viewMode);
        }

        const contentCondition = buildProjectHasVisibleContentCondition(ctx.user, viewMode, overlayChangeRequestIds);

        return await db
          .selectDistinctOn([countries.code], {
            id: countries.id,
            code: countries.code,
            name: countries.name,
            centerCoordinates: countries.centerCoordinates
          })
          .from(countries)
          .innerJoin(cities, eq(cities.countryCode, countries.code))
          .innerJoin(projects, eq(projects.cityId, cities.id))
          .where(and(
            projectCondition,
            contentCondition
          ))
          .orderBy(countries.code, countries.name);
      } catch (error) {
        console.error('Error fetching countries with projects:', error);
        throw new Error('Failed to fetch countries with projects');
      }
    })
});
