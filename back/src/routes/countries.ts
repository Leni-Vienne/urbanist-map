import { publicProcedure, router, TRPCError } from "../trpc";
import { adminBoundaries } from "../db/schema";
import { sql, eq, and, isNotNull } from "drizzle-orm";
import { db } from "../database";

export const countriesRouter = router({
  // List of countries for the moderation country selector. Sourced from the level-2 (country)
  // admin boundaries: their `country_code` is the moderation key, their name is the display label,
  // and a point-on-surface of their geometry gives a center to navigate to. Replaces the former
  // `countries` table.
  getAllCountries: publicProcedure.query(async () => {
    try {
      const countries = await db
        .select({
          // WHERE guarantees non-null; coerce the type so callers get `string`, not `string | null`.
          code: sql<string>`${adminBoundaries.countryCode}`,
          name: adminBoundaries.name,
          center: sql<
            [number, number]
          >`ST_AsGeoJSON(ST_PointOnSurface(${adminBoundaries.geom}), 15)::json -> 'coordinates'`,
        })
        .from(adminBoundaries)
        .where(and(eq(adminBoundaries.adminLevel, 2), isNotNull(adminBoundaries.countryCode)))
        .orderBy(adminBoundaries.name);

      return countries.map(({ code, name, center: [x, y] }) => ({
        code,
        name,
        centerCoordinates: { x, y },
      }));
    } catch (error) {
      console.error("Error fetching all countries:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch countries",
      });
    }
  }),
});
