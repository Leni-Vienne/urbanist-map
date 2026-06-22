import { publicProcedure, router, TRPCError } from "../trpc";
import { z } from "zod";
import { db } from "../database";
import { overlays, projects, adminBoundaries } from "../db/schema";
import { sql, eq, and, desc, type SQL } from "drizzle-orm";

const getLatestContributionsSchema = z.object({
  limit: z.number().min(1).max(50).optional().default(20),
});

// Name variants of one boundary. The feed ships all variants so the client can pick by UI locale
// without the feed taking a locale param, which keeps the server-side cache locale-agnostic.
type LocalizedBoundaryName = {
  name: string; // OSM `name` (usually local language)
  nameEn: string | null; // OSM `name:en`
  names: Record<string, string> | null; // all `name:*` variants, keyed by language code
};

// Location source for a project, resolved by walking its assigned admin boundary's parent_id chain
// (projects.admin_boundary_id -> admin_boundaries). `pick` maps to an OSM admin_level bucket:
//   city    -> deepest of 6..8 (prefers the municipality at 8, e.g. Montréal/Paris; falls back to a
//              county at 6 where no level-8 exists).
//   state   -> level 4 exactly: the canonical province/region (Québec, Ontario, Île-de-France).
//              Odd levels are informal groupings we must skip (5 = "Golden Horseshoe", 3 = "France
//              métropolitaine").
//   country -> level 2.
// Returns NULL when the project has no assigned boundary or the chain lacks that grade.
function boundaryName(pick: "city" | "state" | "country"): SQL<LocalizedBoundaryName | null> {
  const range = {
    city: sql`admin_level BETWEEN 6 AND 8`,
    state: sql`admin_level = 4`,
    country: sql`admin_level = 2`,
  }[pick];
  return sql<LocalizedBoundaryName | null>`(
    WITH RECURSIVE chain AS (
      SELECT osm_id, parent_id, admin_level, name, name_en, names
      FROM ${adminBoundaries} WHERE osm_id = ${projects.adminBoundaryId}
      UNION ALL
      SELECT b.osm_id, b.parent_id, b.admin_level, b.name, b.name_en, b.names
      FROM ${adminBoundaries} b JOIN chain c ON b.osm_id = c.parent_id
    )
    SELECT json_build_object('name', name, 'nameEn', name_en, 'names', names)
    FROM chain WHERE ${range} ORDER BY admin_level DESC LIMIT 1
  )`;
}

// In-memory cache for latest contributions
// Cache expires after 2 minutes or when invalidated
let latestContributionsCache: {
  data: LatestContributionItem[];
  timestamp: number;
  limit: number;
} | null = null;

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// Invalidate cache when new content is approved
export function invalidateLatestContributionsCache() {
  latestContributionsCache = null;
}

// Builds the standalone-projects feed query (approved, named, no approved overlay).
// importFilter splits user-created projects (importSourceId IS NULL) from OSM/citydata imports.
function buildStandaloneProjectsQuery(importFilter: SQL, limit: number) {
  // Imported projects normally sort by their source modification date, but once a user edit
  // has been approved (importLockedAt set) we switch to updatedAt so the approved contribution
  // surfaces in the feed instead of staying buried at the stale OSM date.
  const contributionDate = sql<Date>`CASE
    WHEN ${projects.importLockedAt} IS NOT NULL THEN ${projects.updatedAt}
    ELSE COALESCE(${projects.externalLastModified}, ${projects.updatedAt})
  END`;
  return db
    .select({
      type: sql<"standalone">`'standalone'`,
      id: projects.id,
      name: projects.name,
      filename: sql<null>`NULL`,
      // A standalone project has no map overlay but may have an approved render (artist's
      // impression). Surface its filename so the feed shows the render thumbnail instead of a generic icon.
      renderFilename: sql<string | null>`(
        SELECT ${overlays.filename} FROM ${overlays}
        WHERE ${overlays.projectId} = ${projects.id}
        AND ${overlays.status} = 'approved'
        AND ${overlays.kind} = 'render'
        ORDER BY ${overlays.updatedAt} DESC
        LIMIT 1
      )`,
      updatedAt: contributionDate,
      city: boundaryName("city"),
      state: boundaryName("state"),
      countryCode: projects.countryCode,
      country: boundaryName("country"),
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
    .where(
      and(
        eq(projects.status, "approved"),
        sql`${projects.name} IS NOT NULL`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${overlays}
          WHERE ${overlays.projectId} = ${projects.id}
          AND ${overlays.status} = 'approved'
          AND ${overlays.kind} = 'map'
        )`,
        importFilter,
      ),
    )
    .orderBy(sql`${contributionDate} DESC`)
    .limit(limit);
}

type StandaloneProjectRow = Awaited<ReturnType<typeof buildStandaloneProjectsQuery>>[number];

function mapStandaloneProject(p: StandaloneProjectRow, isImport: boolean) {
  return {
    type: "standalone" as const,
    id: p.id,
    name: p.name,
    filename: null as string | null,
    renderFilename: p.renderFilename,
    updatedAt: p.updatedAt,
    city: p.city,
    state: p.state,
    countryCode: p.countryCode,
    country: p.country,
    lat: p.lat,
    lng: p.lng,
    isImport,
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
    // A point on the geometry itself for marker placement (not a computed center)
    geometryPoint:
      p.geometryPointLat !== null && p.geometryPointLng !== null
        ? { lat: p.geometryPointLat, lng: p.geometryPointLng }
        : null,
  };
}

// One feed entry per project: the most recently updated approved overlay.
// DISTINCT ON (project) collapses a multi-overlay project to a single row so a
// batch approval can't bury every other contribution.
function buildLatestOverlaysQuery(limit: number) {
  const latestOverlayPerProject = db
    .selectDistinctOn([overlays.projectId], {
      type: sql<"overlay">`'overlay'`.as("type"),
      id: overlays.id,
      name: sql<string>`COALESCE(${projects.name}, ${overlays.caption})`.as("name"),
      filename: overlays.filename,
      // Rank by the latest activity on the project: the overlay's date or a later
      // project edit (e.g. an approval that bumped the project), whichever is newer.
      updatedAt: sql<Date>`GREATEST(${overlays.updatedAt}, ${projects.updatedAt})`.as("updatedAt"),
      city: boundaryName("city").as("city"),
      state: boundaryName("state").as("state"),
      countryCode: projects.countryCode,
      country: boundaryName("country").as("country"),
      centroidLat: sql<number>`ST_Y(${overlays.centroid})`.as("centroidLat"),
      centroidLng: sql<number>`ST_X(${overlays.centroid})`.as("centroidLng"),
      corners: sql<{ lat: number; lng: number }[]>`(
        SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
        FROM ST_DumpPoints(${overlays.corners}) AS dump(path, geom)
        WHERE path[2] <= 4
      )`.as("corners"),
    })
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .where(
      and(
        eq(overlays.status, "approved"),
        eq(projects.status, "approved"),
        eq(overlays.kind, "map"),
      ),
    )
    .orderBy(overlays.projectId, desc(overlays.updatedAt))
    .as("latest_overlay_per_project");

  return db
    .select()
    .from(latestOverlayPerProject)
    .orderBy(desc(latestOverlayPerProject.updatedAt))
    .limit(limit);
}

type LatestOverlayRow = Awaited<ReturnType<typeof buildLatestOverlaysQuery>>[number];

function mapOverlayContribution(o: LatestOverlayRow) {
  return {
    type: "overlay" as const,
    id: o.id,
    name: o.name,
    filename: o.filename,
    updatedAt: o.updatedAt,
    city: o.city,
    state: o.state,
    countryCode: o.countryCode,
    country: o.country,
    centroid:
      o.centroidLat !== null && o.centroidLng !== null
        ? { lat: o.centroidLat, lng: o.centroidLng }
        : null,
    corners: o.corners,
    isImport: false,
  };
}

type LatestContributionItem =
  | ReturnType<typeof mapStandaloneProject>
  | ReturnType<typeof mapOverlayContribution>;

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

        const overlaysQuery = buildLatestOverlaysQuery(input.limit);

        // An import with an approved user edit (importLockedAt set) counts as a human
        // contribution, so it joins the direct group rather than the "from OpenStreetMap" one.
        const directProjectsQuery = buildStandaloneProjectsQuery(
          sql`(${projects.importSourceId} IS NULL OR ${projects.importLockedAt} IS NOT NULL)`,
          input.limit,
        );
        const importedProjectsQuery = buildStandaloneProjectsQuery(
          sql`(${projects.importSourceId} IS NOT NULL AND ${projects.importLockedAt} IS NULL)`,
          input.limit,
        );

        const [latestOverlays, directProjectRows, importedProjectRows] = await Promise.all([
          overlaysQuery,
          directProjectsQuery,
          importedProjectsQuery,
        ]);

        const overlayContributions = latestOverlays.map(mapOverlayContribution);

        const directStandaloneContributions = directProjectRows.map((p) =>
          mapStandaloneProject(p, false),
        );
        const importedStandaloneContributions = importedProjectRows.map((p) =>
          mapStandaloneProject(p, true),
        );

        // Direct human contributions (uploads + user-created projects) rank above OSM imports.
        // Each category gets an even share so a flood of either can't bury the other.
        const perCategoryLimit = Math.floor(input.limit / 2);

        const directContributions = [...overlayContributions, ...directStandaloneContributions]
          .toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, perCategoryLimit);

        const combined = [
          ...directContributions,
          ...importedStandaloneContributions.slice(0, perCategoryLimit),
        ];

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
