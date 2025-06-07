import { db } from '../db';
import { countries, cities, projects } from '../db/schema';
import { sql, eq, isNotNull } from 'drizzle-orm';

export interface CountryWithProjects {
  countryCode: string;
  countryName: string;
  centerLat: number;
  centerLng: number;
}

export class CountriesService {
  /**
   * AI : Get countries that have at least one city with projects
   * This is the most performant query for homepage loading
   * Uses indexed joins and early filtering for maximum performance
   */
  static async getCountriesWithProjects(): Promise<CountryWithProjects[]> {
    // AI : Optimized query plan:
    // 1. Filter projects first (smallest table likely)
    // 2. Join with cities using indexed cityId
    // 3. Join with countries using indexed countryCode
    // 4. Group by country to eliminate duplicates
    // 5. Extract coordinates using PostGIS functions
    const result = await db
      .select({
        countryCode: countries.code,
        countryName: countries.name,
        centerLat: sql<number>`ST_Y(${countries.centerCoordinates})`,
        centerLng: sql<number>`ST_X(${countries.centerCoordinates})`,
      })
      .from(countries)
      .innerJoin(cities, eq(cities.countryCode, countries.code))
      .innerJoin(projects, eq(projects.cityId, cities.id))
      .where(isNotNull(projects.id))
      .groupBy(countries.code, countries.name, countries.centerCoordinates)
      .orderBy(countries.name);

    return result;
  }
  /**
   * AI : Alternative method using raw SQL for maximum performance
   * Use this if the ORM query is not fast enough
   */
  static async getCountriesWithProjectsRaw(): Promise<CountryWithProjects[]> {
    const result = await db.execute(sql`
      SELECT DISTINCT
        c.code as "countryCode",
        c.name as "countryName", 
        ST_Y(c.center_coordinates) as "centerLat",
        ST_X(c.center_coordinates) as "centerLng"
      FROM countries c
      INNER JOIN cities ci ON ci.country_code = c.code
      INNER JOIN projects p ON p.city_id = ci.id
      WHERE p.id IS NOT NULL
      ORDER BY c.name
    `);

    return result as CountryWithProjects[];
  }

  /**
   * AI : Fallback method without countries table (less optimal)
   * Use this only if countries table is not populated yet
   */
  static async getCountriesWithProjectsFromCities(): Promise<{
    countryCode: string;
    centerLat: number;
    centerLng: number;
    projectCount: number;
  }[]> {
    const result = await db
      .select({
        countryCode: cities.countryCode,
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
  }
}
