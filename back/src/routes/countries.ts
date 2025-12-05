import { publicProcedure, router } from '../trpc';
import { countries, cities, projects } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../database';
import * as z from 'zod';
import {
  getUserOverlayChangeRequestIds,
  buildProjectVisibilityCondition,
  buildProjectHasVisibleContentCondition,
} from '../db/helpers';
import type { ApprovalStatus } from '../db/schema';

export const countriesRouter = router({
  getAllCountries: publicProcedure
    .query(async () => {
      try {
        // AI : Return all countries for moderation dropdown and other uses
        return await db
          .select({
            code: countries.code,
            name: countries.name,
          })
          .from(countries)
          .orderBy(countries.name);
      } catch (error) {
        console.error('Error fetching all countries:', error);
        throw new Error('Failed to fetch countries', { cause: error });
      }
    }),

  getCountriesWithProjects: publicProcedure
    .input(z.object({
      mode: z.enum(['view', 'edit', 'moderation']).optional().default('view'),
      includeStatus: z.array(z.enum(['pending', 'approved', 'rejected'])).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      try {
        const mode = input?.mode ?? 'view';

        const overlayChangeRequestIds = ctx.user && mode === 'edit'
          ? await getUserOverlayChangeRequestIds(db, ctx.user.id)
          : undefined;

        let projectCondition;
        if (input?.includeStatus && ctx.user?.role === 'admin' && input.includeStatus.length > 0) {
          projectCondition = inArray(projects.status, input.includeStatus as ApprovalStatus[]);
        } else {
          projectCondition = buildProjectVisibilityCondition(ctx.user, mode);
        }

        const contentCondition = buildProjectHasVisibleContentCondition(ctx.user, mode, overlayChangeRequestIds);

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
        throw new Error('Failed to fetch countries with projects', { cause: error });
      }
    })
});
