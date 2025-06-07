import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { db } from '../db';
import { cities, projects } from '../db/schema';
import { sql, eq, isNotNull } from 'drizzle-orm';

export const countriesAlternativeRouter = router({
  // AI : Get countries with projects using city centroid calculation (less optimal)
  getCountriesWithProjectsFromCities: publicProcedure
    .query(async () => {
      // AI : Calculate country center from city coordinates - less performant but works without countries table
      const result = await db
        .select({
          countryCode: cities.countryCode,
          // AI : Calculate centroid of all cities in the country
          centerLat: sql<number>`AVG(ST_Y(${cities.coordinates}))`,
          centerLng: sql<number>`AVG(ST_X(${cities.coordinates}))`,
          projectCount: sql<number>`COUNT(DISTINCT ${projects.id})`,
        })
        .from(cities)
        .innerJoin(projects, eq(projects.cityId, cities.id))
        .where(isNotNull(projects.id))
        .groupBy(cities.countryCode)
        .orderBy(cities.countryCode);

      return result;
    }),
});
