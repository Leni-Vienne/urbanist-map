import { publicProcedure, router } from '../trpc';
import { db } from '../db';
import { countries, cities, projects } from '../db/schema';
import { eq, exists } from 'drizzle-orm';

export const countriesRouter = router({
  // AI : Get all countries that have at least one city with a project
  getCountriesWithProjects: publicProcedure
    .query(async () => {
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
              .where(eq(cities.countryCode, countries.code))
          )
        )
        .orderBy(countries.name);
    })
});
