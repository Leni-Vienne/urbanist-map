import { publicProcedure, router, TRPCError } from "../trpc";
import { z } from "zod";
import { db } from "../database";
import { overlays, projects, cities, countries } from "../db/schema";
import { sql, eq, and, desc } from "drizzle-orm";

const getLatestContributionsSchema = z.object({
  limit: z.number().min(1).max(50).optional().default(20),
});

// In-memory cache for latest contributions
// Cache expires after 2 minutes or when invalidated
let latestContributionsCache: {
  data: any[];
  timestamp: number;
  limit: number;
} | null = null;

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// Invalidate cache when new content is approved
export function invalidateLatestContributionsCache() {
  latestContributionsCache = null;
}

export const feedRouter = router({
  getLatestContributions: publicProcedure
    .input(getLatestContributionsSchema)
    .query(async ({ input }) => {
      try {
        const now = Date.now();
        if (
          latestContributionsCache &&
          latestContributionsCache.limit >= input.limit &&
          now - latestContributionsCache.timestamp < CACHE_TTL
        ) {
          return latestContributionsCache.data.slice(0, input.limit);
        }

        const overlaysQuery = db
          .select({
            type: sql<"overlay">`'overlay'`,
            id: overlays.id,
            name: sql<string>`COALESCE(${overlays.caption}, ${projects.name})`,
            filename: overlays.filename,
            updatedAt: overlays.updatedAt,
            cityName: cities.name,
            countryCode: projects.countryCode,
            countryName: countries.name,
            centroidLat: sql<number>`ST_Y(${overlays.centroid})`,
            centroidLng: sql<number>`ST_X(${overlays.centroid})`,
            corners: sql<{ lat: number; lng: number }[]>`(
              SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
              FROM ST_DumpPoints(${overlays.corners}) AS dump(path, geom)
              WHERE path[2] <= 4
            )`,
            status: overlays.status,
            lat: sql<null>`NULL`,
            lng: sql<null>`NULL`,
          })
          .from(overlays)
          .leftJoin(projects, eq(overlays.projectId, projects.id))
          .leftJoin(cities, eq(projects.cityId, cities.id))
          .leftJoin(countries, eq(projects.countryCode, countries.code))
          .where(and(eq(overlays.status, "approved"), eq(projects.status, "approved")))
          .orderBy(desc(overlays.updatedAt))
          .limit(input.limit);

        const projectsQuery = db
          .select({
            type: sql<"standalone">`'standalone'`,
            id: projects.id,
            name: projects.name,
            filename: sql<null>`NULL`,
            updatedAt: sql<Date>`COALESCE(${projects.externalLastModified}, ${projects.updatedAt})`,
            cityName: cities.name,
            countryCode: projects.countryCode,
            countryName: countries.name,
            centroidLat: sql<null>`NULL`,
            centroidLng: sql<null>`NULL`,
            corners: sql<null>`NULL`,
            status: projects.status,
            lat: projects.lat,
            lng: projects.lng,
            // Bounding box of project geometry for flying to the right area when clicked
            geometryBboxMinLat: sql<
              number | null
            >`CASE WHEN ${projects.geometry} IS NOT NULL THEN ST_YMin(ST_Envelope(${projects.geometry})) ELSE NULL END`,
            geometryBboxMaxLat: sql<
              number | null
            >`CASE WHEN ${projects.geometry} IS NOT NULL THEN ST_YMax(ST_Envelope(${projects.geometry})) ELSE NULL END`,
            geometryBboxMinLng: sql<
              number | null
            >`CASE WHEN ${projects.geometry} IS NOT NULL THEN ST_XMin(ST_Envelope(${projects.geometry})) ELSE NULL END`,
            geometryBboxMaxLng: sql<
              number | null
            >`CASE WHEN ${projects.geometry} IS NOT NULL THEN ST_XMax(ST_Envelope(${projects.geometry})) ELSE NULL END`,
            // A point guaranteed to lie on the geometry itself (midpoint of a line, surface point of a polygon)
            geometryPointLat: sql<
              number | null
            >`CASE WHEN ${projects.geometry} IS NOT NULL THEN ST_Y(ST_PointOnSurface(${projects.geometry})) ELSE NULL END`,
            geometryPointLng: sql<
              number | null
            >`CASE WHEN ${projects.geometry} IS NOT NULL THEN ST_X(ST_PointOnSurface(${projects.geometry})) ELSE NULL END`,
          })
          .from(projects)
          .leftJoin(cities, eq(projects.cityId, cities.id))
          .leftJoin(countries, eq(projects.countryCode, countries.code))
          .where(
            and(
              eq(projects.status, "approved"),
              sql`${projects.name} IS NOT NULL`,
              sql`NOT EXISTS (
                SELECT 1 FROM ${overlays}
                WHERE ${overlays.projectId} = ${projects.id}
                AND ${overlays.status} = 'approved'
              )`,
            ),
          )
          .orderBy(sql`COALESCE(${projects.externalLastModified}, ${projects.updatedAt}) DESC`)
          .limit(input.limit);

        const [latestOverlays, latestStandaloneProjects] = await Promise.all([
          overlaysQuery,
          projectsQuery,
        ]);

        const overlayContributions = latestOverlays.map((o) => ({
          type: "overlay" as const,
          id: o.id,
          name: o.name,
          filename: o.filename,
          updatedAt: o.updatedAt,
          cityName: o.cityName,
          countryCode: o.countryCode,
          countryName: o.countryName,
          centroid:
            o.centroidLat !== null && o.centroidLng !== null
              ? { lat: o.centroidLat, lng: o.centroidLng }
              : null,
          corners: o.corners,
          status: o.status,
        }));

        const standaloneProjectContributions = latestStandaloneProjects.map((p) => ({
          type: "standalone" as const,
          id: p.id,
          name: p.name,
          filename: null as string | null,
          updatedAt: p.updatedAt,
          cityName: p.cityName,
          countryCode: p.countryCode,
          countryName: p.countryName,
          lat: p.lat,
          lng: p.lng,
          status: p.status,
          // Geometry bbox for flying to the right bounds when the project has vector shapes
          geometryBbox:
            p.geometryBboxMinLat !== null &&
            p.geometryBboxMaxLat !== null &&
            p.geometryBboxMinLng !== null &&
            p.geometryBboxMaxLng !== null
              ? {
                  minLat: p.geometryBboxMinLat,
                  maxLat: p.geometryBboxMaxLat,
                  minLng: p.geometryBboxMinLng,
                  maxLng: p.geometryBboxMaxLng,
                }
              : null,
          // A point on the geometry itself for popup placement (not a computed center)
          geometryPoint:
            p.geometryPointLat !== null && p.geometryPointLng !== null
              ? { lat: p.geometryPointLat, lng: p.geometryPointLng }
              : null,
        }));

        // Combine and sort by updatedAt descending
        const combined = [...overlayContributions, ...standaloneProjectContributions]
          .toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, input.limit);

        latestContributionsCache = {
          data: combined,
          timestamp: now,
          limit: input.limit,
        };

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
