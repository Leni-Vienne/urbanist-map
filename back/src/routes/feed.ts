import { publicProcedure, router, TRPCError } from "../trpc";
import { z } from "zod";
import { db } from "../database";
import { overlays, projects, adminBoundaries, importSources } from "../db/schema";
import { sql, eq, and, or, desc, type SQL } from "drizzle-orm";
import {
  advanceFeedCursor,
  EXHAUSTED_STREAM,
  type FeedCursor,
  type FeedStreamCursor,
  type FeedStreamName,
  type FetchedCounts,
} from "./feedCursor";

// Position of the last row consumed from one underlying query. Each query keeps its own, so a
// page boundary never falls between two rows sharing a timestamp.
const feedPositionSchema = z.object({ date: z.string(), id: z.string() });
const feedStreamCursorSchema = z.union([feedPositionSchema, z.literal(EXHAUSTED_STREAM)]);

const feedCursorSchema = z.object({
  overlay: feedStreamCursorSchema.nullish(),
  direct: feedStreamCursorSchema.nullish(),
  imported: feedStreamCursorSchema.nullish(),
});

const MAX_WEB_MERCATOR_LATITUDE = 85.05112878;

const mapAreaSchema = z
  .object({
    west: z.number().min(-180).max(180),
    south: z.number().min(-MAX_WEB_MERCATOR_LATITUDE).max(MAX_WEB_MERCATOR_LATITUDE),
    east: z.number().min(-180).max(180),
    north: z.number().min(-MAX_WEB_MERCATOR_LATITUDE).max(MAX_WEB_MERCATOR_LATITUDE),
  })
  .refine((bounds) => bounds.south < bounds.north, {
    message: "Map area must have a positive height",
  })
  .refine(
    (bounds) => {
      const longitudeSpan =
        bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
      return longitudeSpan <= 90 && bounds.north - bounds.south <= 50;
    },
    { message: "Map area is too large" },
  );

const getLatestContributionsSchema = z.object({
  limit: z.number().min(1).max(50).optional().default(20),
  cursor: feedCursorSchema.nullish(),
  source: z.enum(["all", "community", "osm"]).optional().default("all"),
  tags: z.array(z.string()).optional(),
  includeUntagged: z.boolean().optional(),
  statuses: z.array(z.string()).optional(),
  minSizeM: z.number().optional(),
  maxSizeM: z.number().optional(),
  modifiedAfterMs: z.number().optional(),
  modifiedBeforeMs: z.number().optional(),
  named: z.enum(["named", "unnamed"]).optional(),
  onlyWithImages: z.boolean().optional(),
  mapArea: mapAreaSchema.optional(),
});

type FeedInput = z.infer<typeof getLatestContributionsSchema>;
type MapArea = z.infer<typeof mapAreaSchema>;

// Name variants of one boundary. Shipping every locale the UI can render, rather than a single
// resolved name, keeps the feed free of a locale param and its cached pages locale-agnostic.
type LocalizedBoundaryName = {
  name: string; // OSM `name` (usually local language)
  nameEn: string | null; // OSM `name:en`
  names: Record<string, string> | null; // `name:*` variants for BOUNDARY_NAME_LOCALES
};

// Locales whose OSM `name:<code>` variant reaches the client; must cover the app's selectable UI
// locales, minus English, which travels as nameEn. A boundary carries up to ~260 `name:*` variants
// (France alone), so this projection is worth kilobytes per row. An omitted locale falls back to
// the English or native name.
const BOUNDARY_NAME_LOCALES = ["fr"];

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
    SELECT json_build_object('name', name, 'nameEn', name_en, 'names', (
      SELECT json_object_agg(n.k, n.v)
      FROM jsonb_each_text(COALESCE(names, '{}'::jsonb)) AS n(k, v)
      WHERE n.k = ANY(${textArray(BOUNDARY_NAME_LOCALES)})
    ))
    FROM chain WHERE ${range} ORDER BY admin_level DESC LIMIT 1
  )`;
}

// Binds one param per element, so the value reaches Postgres as an array rather than as a
// comma-separated parameter list.
function textArray(values: string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

// Project-level predicates shared by every feed query. `nameColumn` differs per query because an
// overlay falls back to its caption when its project is unnamed.
function projectFilterConditions(input: FeedInput, nameColumn: SQL | typeof projects.name): SQL[] {
  const conditions: SQL[] = [];

  const tagMatches: SQL[] = [];
  if (input.tags && input.tags.length > 0) {
    tagMatches.push(sql`${projects.tags} && ${textArray(input.tags)}`);
  }
  if (input.includeUntagged) {
    tagMatches.push(sql`COALESCE(cardinality(${projects.tags}), 0) = 0`);
  }
  if (tagMatches.length > 0) {
    const combined = or(...tagMatches);
    if (combined) conditions.push(combined);
  }

  if (input.statuses && input.statuses.length > 0) {
    conditions.push(sql`${projects.timelineStatus} = ANY(${textArray(input.statuses)})`);
  }
  // NULL geometry_size_m (no geometry) falls outside any explicit bound.
  if (input.minSizeM !== undefined) {
    conditions.push(sql`${projects.geometrySizeM} >= ${input.minSizeM}`);
  }
  if (input.maxSizeM !== undefined) {
    conditions.push(sql`${projects.geometrySizeM} <= ${input.maxSizeM}`);
  }
  if (input.named === "named") {
    conditions.push(sql`${nameColumn} IS NOT NULL`);
  } else if (input.named === "unnamed") {
    conditions.push(sql`${nameColumn} IS NULL`);
  }

  return conditions;
}

function dateRangeConditions(input: FeedInput, dateExpr: SQL): SQL[] {
  const conditions: SQL[] = [];
  if (input.modifiedAfterMs !== undefined) {
    conditions.push(sql`${dateExpr} >= ${new Date(input.modifiedAfterMs)}`);
  }
  if (input.modifiedBeforeMs !== undefined) {
    conditions.push(sql`${dateExpr} <= ${new Date(input.modifiedBeforeMs)}`);
  }
  return conditions;
}

function intersectsMapArea(geometry: SQL, area: MapArea): SQL {
  const westToEast = sql`ST_MakeEnvelope(${area.west}, ${area.south}, ${area.east}, ${area.north}, 4326)`;
  if (area.west <= area.east) {
    return sql`(${geometry} && ${westToEast} AND ST_Intersects(${geometry}, ${westToEast}))`;
  }

  const westToDateline = sql`ST_MakeEnvelope(${area.west}, ${area.south}, 180, ${area.north}, 4326)`;
  const datelineToEast = sql`ST_MakeEnvelope(-180, ${area.south}, ${area.east}, ${area.north}, 4326)`;
  return sql`(
    (${geometry} && ${westToDateline} AND ST_Intersects(${geometry}, ${westToDateline}))
    OR (${geometry} && ${datelineToEast} AND ST_Intersects(${geometry}, ${datelineToEast}))
  )`;
}

function standaloneMapAreaConditions(input: FeedInput): SQL[] {
  if (!input.mapArea) return [];
  const area = input.mapArea;
  return [
    sql`(
      ${intersectsMapArea(sql`${projects.geometry}`, area)}
      OR ${intersectsMapArea(sql`${projects.centerCoordinate}`, area)}
    )`,
  ];
}

function overlayMapAreaConditions(input: FeedInput): SQL[] {
  if (!input.mapArea) return [];
  return [intersectsMapArea(sql`${overlays.corners}`, input.mapArea)];
}

// Keyset predicate. Row comparison orders by date then id, matching the ORDER BY, so rows sharing
// a timestamp are still split at an exact position.
function keysetCondition(
  dateExpr: SQL,
  idExpr: SQL | typeof projects.id,
  cursor: FeedStreamCursor | null | undefined,
): SQL[] {
  if (!cursor || cursor === EXHAUSTED_STREAM) return [];
  return [
    sql`(${dateExpr}, ${idExpr}) < (${new Date(cursor.date)}::timestamptz, ${cursor.id}::uuid)`,
  ];
}

// Builds the standalone-projects feed query (approved, no approved map overlay).
// The candidate subquery keeps sorting and pagination independent from the recursive location and
// geometry projections used to hydrate the selected page.
function buildStandaloneProjectsQuery(
  stream: "direct" | "imported",
  limit: number,
  input: FeedInput,
  cursor: FeedStreamCursor | null | undefined,
) {
  const isImported = stream === "imported";
  const contributionDate = isImported
    ? sql<Date>`COALESCE(${projects.externalLastModified}, ${projects.updatedAt})`
    : sql<Date>`CASE
        WHEN ${projects.importLockedAt} IS NOT NULL THEN ${projects.updatedAt}
        ELSE COALESCE(${projects.externalLastModified}, ${projects.updatedAt})
      END`;
  const importFilter = isImported
    ? sql`(${projects.importSourceId} IS NOT NULL AND ${projects.importLockedAt} IS NULL)`
    : sql`(${projects.importSourceId} IS NULL OR ${projects.importLockedAt} IS NOT NULL)`;
  const approvedRender = sql`(
    SELECT ${overlays.filename} FROM ${overlays}
    WHERE ${overlays.projectId} = ${projects.id}
    AND ${overlays.status} = 'approved'
    AND ${overlays.kind} = 'render'
    ORDER BY ${overlays.updatedAt} DESC
    LIMIT 1
  )`;

  const conditions: SQL[] = [
    sql`${projects.status} = 'approved'`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${overlays}
      WHERE ${overlays.projectId} = ${projects.id}
      AND ${overlays.status} = 'approved'
      AND ${overlays.kind} = 'map'
    )`,
    importFilter,
    ...projectFilterConditions(input, projects.name),
    ...dateRangeConditions(input, contributionDate),
    ...standaloneMapAreaConditions(input),
    ...keysetCondition(contributionDate, projects.id, cursor),
  ];
  // A standalone project's only image is its approved render.
  if (input.onlyWithImages) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${overlays}
      WHERE ${overlays.projectId} = ${projects.id}
      AND ${overlays.status} = 'approved'
      AND ${overlays.kind} = 'render'
    )`);
  }

  const candidates = db
    .select({
      id: projects.id,
      updatedAt: contributionDate.as("updatedAt"),
    })
    .from(projects)
    .where(and(...conditions))
    .orderBy(sql`${contributionDate} DESC, ${projects.id} DESC`)
    .limit(limit)
    .as("standalone_candidates");

  return db
    .select({
      type: sql<"standalone">`'standalone'`,
      id: projects.id,
      name: projects.name,
      filename: sql<null>`NULL`,
      // A standalone project has no map overlay but may have an approved render (artist's
      // impression). Surface its filename so the feed shows the render thumbnail instead of a generic icon.
      renderFilename: sql<string | null>`${approvedRender}`,
      updatedAt: candidates.updatedAt,
      city: boundaryName("city"),
      state: boundaryName("state"),
      countryCode: projects.countryCode,
      country: boundaryName("country"),
      tags: projects.tags,
      // Simplified, low-precision shape used as the thumbnail for untagged projects, which have no
      // category icon to fall back on. Only fetched for those rows to keep the payload small.
      shape: sql<GeoJSON.GeometryCollection | null>`CASE
        WHEN ${projects.geometry} IS NOT NULL AND COALESCE(cardinality(${projects.tags}), 0) = 0
        THEN ST_AsGeoJSON(ST_Simplify(${projects.geometry}, 0.00003), 5)::json
        ELSE NULL
      END`,
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
    .from(candidates)
    .innerJoin(projects, eq(projects.id, candidates.id))
    .orderBy(desc(candidates.updatedAt), desc(candidates.id));
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
    tags: p.tags ?? [],
    shape: p.shape,
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
function buildLatestOverlaysQuery(
  limit: number,
  input: FeedInput,
  cursor: FeedStreamCursor | null | undefined,
) {
  // Rank by the latest activity on the project: the overlay's date or a later
  // project edit (e.g. an approval that bumped the project), whichever is newer.
  const contributionDate = sql<Date>`GREATEST(${overlays.updatedAt}, ${projects.updatedAt})`;
  const overlayName = sql<string>`COALESCE(${projects.name}, ${overlays.caption})`;

  const latestOverlayPerProject = db
    .selectDistinctOn([overlays.projectId], {
      type: sql<"overlay">`'overlay'`.as("type"),
      id: overlays.id,
      name: overlayName.as("name"),
      filename: overlays.filename,
      updatedAt: contributionDate.as("updatedAt"),
      city: boundaryName("city").as("city"),
      state: boundaryName("state").as("state"),
      countryCode: projects.countryCode,
      country: boundaryName("country").as("country"),
      tags: projects.tags,
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
        ...projectFilterConditions(input, overlayName),
        ...dateRangeConditions(input, contributionDate),
        ...overlayMapAreaConditions(input),
      ),
    )
    .orderBy(overlays.projectId, desc(overlays.updatedAt))
    .as("latest_overlay_per_project");

  // The keyset lands outside the DISTINCT ON, whose ordering picks the surviving overlay per
  // project rather than the feed order.
  return db
    .select()
    .from(latestOverlayPerProject)
    .where(
      and(
        ...keysetCondition(
          sql`${latestOverlayPerProject.updatedAt}`,
          sql`${latestOverlayPerProject.id}`,
          cursor,
        ),
      ),
    )
    .orderBy(desc(latestOverlayPerProject.updatedAt), desc(latestOverlayPerProject.id))
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
    tags: o.tags ?? [],
    centroid:
      typeof o.centroidLat === "number" && typeof o.centroidLng === "number"
        ? { lat: o.centroidLat, lng: o.centroidLng }
        : null,
    corners: o.corners,
    isImport: false,
  };
}

type LatestContributionItem =
  | ReturnType<typeof mapStandaloneProject>
  | ReturnType<typeof mapOverlayContribution>;

// A fetched row tagged with the query it came from, so the emitted page can advance exactly the
// cursors it consumed.
type PendingRow = { stream: FeedStreamName; item: LatestContributionItem };

function rowTime(row: PendingRow): number {
  return new Date(row.item.updatedAt).getTime();
}

function mergeStreams(rows: PendingRow[], limit: number): PendingRow[] {
  return rows.toSorted(byNewest).slice(0, limit);
}

function byNewest(a: PendingRow, b: PendingRow): number {
  return rowTime(b) - rowTime(a);
}

type FeedPage = {
  items: LatestContributionItem[];
  nextCursor: FeedCursor | null;
};

// Only the default, unfiltered first page is cached: it is the one every visitor requests, and
// keying the cache on a filter combination would make it unbounded.
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const firstPageCache = new Map<string, { page: FeedPage; timestamp: number }>();

export function invalidateLatestContributionsCache() {
  firstPageCache.clear();
}

function cacheKey(input: FeedInput): string | null {
  const isDefaultPage =
    !input.cursor &&
    !input.tags?.length &&
    !input.includeUntagged &&
    !input.statuses?.length &&
    input.minSizeM === undefined &&
    input.maxSizeM === undefined &&
    input.modifiedAfterMs === undefined &&
    input.modifiedBeforeMs === undefined &&
    input.named === undefined &&
    !input.onlyWithImages &&
    input.mapArea === undefined;
  return isDefaultPage ? `${input.source}|${input.limit}` : null;
}

function shouldQueryStream(enabled: boolean, cursor: FeedStreamCursor | null | undefined): boolean {
  return enabled && cursor !== EXHAUSTED_STREAM;
}

export const feedRouter = router({
  getOsmSyncStatus: publicProcedure.query(async () => {
    const [row] = await db
      .select({ lastSyncedAt: sql<Date | null>`MAX(${importSources.lastSyncAt})` })
      .from(importSources)
      .where(and(eq(importSources.type, "osm"), eq(importSources.enabled, true)));
    return { lastSyncedAt: row?.lastSyncedAt ?? null };
  }),

  getLatestContributions: publicProcedure
    .input(getLatestContributionsSchema)
    .query(async ({ input }): Promise<FeedPage> => {
      try {
        const now = Date.now();
        const key = cacheKey(input);
        if (key) {
          const hit = firstPageCache.get(key);
          if (hit && now - hit.timestamp < CACHE_TTL) {
            return hit.page;
          }
        }

        // Over-fetch by one per stream so a full page can still tell whether more rows exist.
        const fetchSize = input.limit + 1;
        const wantsCommunity = input.source !== "osm";
        const wantsImported = input.source !== "community";
        const queryOverlays = shouldQueryStream(wantsCommunity, input.cursor?.overlay);
        const queryDirect = shouldQueryStream(wantsCommunity, input.cursor?.direct);
        const queryImported = shouldQueryStream(wantsImported, input.cursor?.imported);

        // An import with an approved user edit (importLockedAt set) counts as a human
        // contribution, so it joins the direct group rather than the import one.
        const [overlayRows, directRows, importedRows] = await Promise.all([
          queryOverlays
            ? buildLatestOverlaysQuery(fetchSize, input, input.cursor?.overlay)
            : Promise.resolve([]),
          queryDirect
            ? buildStandaloneProjectsQuery("direct", fetchSize, input, input.cursor?.direct)
            : Promise.resolve([]),
          queryImported
            ? buildStandaloneProjectsQuery("imported", fetchSize, input, input.cursor?.imported)
            : Promise.resolve([]),
        ]);

        const pending: PendingRow[] = [
          ...overlayRows.map((o) => ({
            stream: "overlay" as const,
            item: mapOverlayContribution(o),
          })),
          ...directRows.map((p) => ({
            stream: "direct" as const,
            item: mapStandaloneProject(p, false),
          })),
          ...importedRows.map((p) => ({
            stream: "imported" as const,
            item: mapStandaloneProject(p, true),
          })),
        ];

        const emitted = mergeStreams(pending, input.limit);
        const fetchedCounts: FetchedCounts = {
          overlay: queryOverlays ? overlayRows.length : null,
          direct: queryDirect ? directRows.length : null,
          imported: queryImported ? importedRows.length : null,
        };
        const page: FeedPage = {
          items: emitted.map((row) => row.item),
          nextCursor:
            emitted.length < pending.length
              ? advanceFeedCursor(emitted, input.cursor, fetchedCounts, fetchSize)
              : null,
        };

        if (key) {
          firstPageCache.set(key, { page, timestamp: now });
        }

        return page;
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
