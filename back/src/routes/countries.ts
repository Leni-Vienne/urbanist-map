import { publicProcedure, router } from '../trpc';
import { countries, cities, projects } from '../db/schema';
import { eq, exists } from 'drizzle-orm';
import { getDb } from '../shared/db-util';

export const countriesRouter = router({
  // AI : Get all countries that have at least one city with a project
  getCountriesWithProjects: publicProcedure
    .query(async () => {
      try {
        return await getDb()
          .select({
            id: countries.id,
            code: countries.code,
            name: countries.name,
            centerCoordinates: countries.centerCoordinates
          })
          .from(countries)
          .where(
            exists(
              getDb()
                .select()
                .from(cities)
                .innerJoin(projects, eq(projects.cityId, cities.id))
                .where(eq(cities.countryCode, countries.code))
            )
          )
          .orderBy(countries.name);
        } catch (error) {
          console.error('Error fetching countries with projects:', error);
          throw new Error('Failed to fetch countries with projects');
        }
    })
});
