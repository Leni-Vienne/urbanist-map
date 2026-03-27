import { publicProcedure, router, TRPCError } from "../trpc";
import { z } from "zod";
import { db } from "../database";
import { overlays, projects, cities, countries } from "../db/schema";
import { sql, eq, and } from "drizzle-orm";
import { buildOverlayQuery } from "../db/helpers";

const getLatestContributionsSchema = z.object({
  limit: z.number().min(1).max(50).optional().default(20),
});

export const feedRouter = router({
  getLatestContributions: publicProcedure
    .input(getLatestContributionsSchema)
    .query(async ({ input }) => {
      try {
        // Fetch overlays with their project and location info
        const latestOverlays = await buildOverlayQuery(db)
          .where(and(eq(overlays.status, "approved"), eq(projects.status, "approved")))
          .orderBy(sql`${overlays.updatedAt} DESC`)
          .limit(input.limit);

        // Fetch projects without overlays (standalone projects) with location info
        const latestStandaloneProjects = await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            status: projects.status,
            lat: projects.lat,
            lng: projects.lng,
            updatedAt: sql<Date>`COALESCE(${projects.externalLastModified}, ${projects.updatedAt})`,
            cityId: cities.id,
            cityName: cities.name,
            countryCode: countries.code,
            countryName: countries.name,
          })
          .from(projects)
          .leftJoin(cities, eq(projects.cityId, cities.id))
          .leftJoin(countries, eq(projects.countryCode, countries.code))
          .leftJoin(
            overlays,
            and(eq(overlays.projectId, projects.id), eq(overlays.status, "approved")),
          )
          .where(and(eq(projects.status, "approved"), sql`${projects.name} is not null`))
          .groupBy(projects.id, cities.id, cities.name, countries.code, countries.name)
          .having(sql`COUNT(${overlays.id}) = 0`)
          .orderBy(sql`COALESCE(${projects.externalLastModified}, ${projects.updatedAt}) DESC`)
          .limit(input.limit);

        // Transform and combine results with discriminated union type
        const overlayContributions = latestOverlays.map((o) => ({
          type: "overlay" as const,
          id: o.id,
          name: o.caption || o.projectName, // fallback to project name if caption is missing or empty
          filename: o.filename,
          updatedAt: o.updatedAt,
          cityId: o.cityId,
          cityName: o.cityName,
          countryCode: o.countryCode,
          countryName: o.countryName,
          // Include overlay-specific fields for navigation
          centroid: o.centroid,
          status: o.status,
        }));

        const standaloneProjectContributions = latestStandaloneProjects.map((d) => ({
          type: "standalone" as const,
          id: d.id,
          name: d.name,
          filename: null as string | null,
          updatedAt: d.updatedAt,
          cityId: d.cityId,
          cityName: d.cityName,
          countryCode: d.countryCode,
          countryName: d.countryName,
          // Include standalone-project-specific fields for navigation
          lat: d.lat,
          lng: d.lng,
          status: d.status,
        }));

        // Combine and sort by updatedAt descending
        const combined = [...overlayContributions, ...standaloneProjectContributions]
          .toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, input.limit);

        return combined;
      } catch (error) {
        console.error("Error in getLatestContributions:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch latest contributions",
          cause: error,
        });
      }
    }),
});
