import { publicProcedure, router } from '../trpc';
import { countries, cities, projects } from '../db/schema';
import { eq, exists, and, inArray } from 'drizzle-orm';
import { db } from '../database';
import * as z from 'zod';

export const countriesRouter = router({
  // AI : Get all countries that have at least one city with an approved project
  getCountriesWithProjects: publicProcedure
    .input(z.object({
      includeStatus: z.array(z.enum(['pending', 'approved', 'rejected'])).optional(), // AI : Optional status filter for admins
    }).optional())
    .query(async ({ input, ctx }) => {
      try {
        // AI : Build status condition based on admin privileges
        let statusCondition;
        if (input?.includeStatus && ctx.user?.role === 'admin' && input.includeStatus.length > 0) {
          statusCondition = inArray(projects.status, input.includeStatus);
        } else {
          statusCondition = eq(projects.status, 'approved');
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
                  statusCondition
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
