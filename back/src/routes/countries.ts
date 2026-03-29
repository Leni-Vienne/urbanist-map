import { publicProcedure, router, TRPCError } from "../trpc";
import { countries } from "../db/schema";
import { db } from "../database";

export const countriesRouter = router({
  getAllCountries: publicProcedure.query(async () => {
    try {
      // Return all countries for moderation dropdown and other uses
      return await db
        .select({
          code: countries.code,
          name: countries.name,
          centerCoordinates: countries.centerCoordinates,
        })
        .from(countries)
        .orderBy(countries.name);
    } catch (error) {
      console.error("Error fetching all countries:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch countries",
      });
    }
  }),
});
