import { publicProcedure, router, TRPCError } from "../trpc";
import { z } from "zod";
import { db } from "../database";
import { overlays, projects, importSources } from "../db/schema";
import { sql, eq, and, or, desc, type SQL } from "drizzle-orm";
import { boundaryName, textArray } from "../db/helpers";
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

const feedQuerySchema = z.object({
  source: z.enum(["all", "community", "osm"]).optional().default("all"),
  tags: z.array(z.string()).optional().default([]),
  includeUntagged: z.boolean().optional(),
  statuses: z.array(z.string()).optional().default([]),
  minSizeM: z.number().optional(),
  maxSizeM: z.number().optional(),
  modifiedAfterMs: z.number().optional(),
  modifiedBeforeMs: z.number().optional(),
  named: z.enum(["named", "unnamed"]).optional(),
  onlyWithImages: z.boolean().optional(),
  mapArea: mapAreaSchema.optional(),
});

const getLatestContributionsSchema = feedQuerySchema.extend({
  limit: z.number().min(1).max(50).optional().default(20),
  cursor: feedCursorSchema.nullish(),
});

type FeedInput = z.infer<typeof feedQuerySchema>;
type FeedPageInput = z.infer<typeof getLatestContributionsSchema>;
type MapArea = z.infer<typeof mapAreaSchema>;

function projectFilterConditions(input: FeedInput): SQL[] {
  const conditions: SQL[] = [];

  const tagMatches: SQL[] = [];
  if (input.tags.length > 0) {
    tagMatches.push(sql`${projects.tags} && ${textArray(input.tags)}`);
  }
  if (input.includeUntagged) {
    tagMatches.push(sql`COALESCE(cardinality(${projects.tags}), 0) = 0`);
  }
  if (tagMatches.length > 0) {
    const combined = or(...tagMatches);
    if (combined) conditions.push(combined);
  }

  if (input.statuses.length > 0) {
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
    conditions.push(sql`NULLIF(BTRIM(${projects.name}), '') IS NOT NULL`);
  } else if (input.named === "unnamed") {
    conditions.push(sql`NULLIF(BTRIM(${projects.name}), '') IS NULL`);
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
  if (cursor === null || cursor === undefined || cursor === EXHAUSTED_STREAM) return [];
  return [
    sql`(${dateExpr}, ${idExpr}) < (${new Date(cursor.date)}::timestamptz, ${cursor.id}::uuid)`,
  ];
}

type StandaloneStream = "direct" | "imported";

function standaloneContributionDate(stream: StandaloneStream): SQL<Date> {
  return stream === "imported"
    ? sql<Date>`COALESCE(${projects.externalLastModified}, ${projects.updatedAt})`
    : sql<Date>`CASE
        WHEN ${projects.importLockedAt} IS NOT NULL THEN ${projects.updatedAt}
        ELSE COALESCE(${projects.externalLastModified}, ${projects.updatedAt})
      END`;
}

function standaloneImportFilter(stream: StandaloneStream): SQL {
  return stream === "imported"
    ? sql`(${projects.importSourceId} IS NOT NULL AND ${projects.importLockedAt} IS NULL)`
    : sql`(${projects.importSourceId} IS NULL OR ${projects.importLockedAt} IS NOT NULL)`;
}

function standaloneConditions(
  stream: StandaloneStream,
  input: FeedInput,
  cursor?: FeedStreamCursor | null,
): SQL[] {
  const contributionDate = standaloneContributionDate(stream);
  const conditions: SQL[] = [
    sql`${projects.status} = 'approved'`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${overlays}
      WHERE ${overlays.projectId} = ${projects.id}
      AND ${overlays.status} = 'approved'
      AND ${overlays.kind} = 'map'
    )`,
    standaloneImportFilter(stream),
    ...projectFilterConditions(input),
    ...dateRangeConditions(
      input,
      sql`COALESCE(${projects.externalLastModified}, ${projects.updatedAt})`,
    ),
    ...standaloneMapAreaConditions(input),
    ...keysetCondition(contributionDate, projects.id, cursor),
  ];

  if (input.onlyWithImages) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${overlays}
      WHERE ${overlays.projectId} = ${projects.id}
      AND ${overlays.status} = 'approved'
      AND ${overlays.kind} = 'render'
    )`);
  }

  return conditions;
}

// Builds the standalone-projects feed query (approved, no approved map overlay).
// The candidate subquery keeps sorting and pagination independent from the recursive location and
// geometry projections used to hydrate the selected page.
function buildStandaloneProjectsQuery(
  stream: StandaloneStream,
  limit: number,
  input: FeedInput,
  cursor: FeedStreamCursor | null | undefined,
) {
  const contributionDate = standaloneContributionDate(stream);
  const approvedRender = sql`(
    SELECT ${overlays.filename} FROM ${overlays}
    WHERE ${overlays.projectId} = ${projects.id}
    AND ${overlays.status} = 'approved'
    AND ${overlays.kind} = 'render'
    ORDER BY ${overlays.updatedAt} DESC
    LIMIT 1
  )`;

  const candidates = db
    .select({
      id: projects.id,
      updatedAt: contributionDate.as("updatedAt"),
    })
    .from(projects)
    .where(and(...standaloneConditions(stream, input, cursor)))
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
      // Simplified, low-precision shape used as the thumbnail for untagged projects and projects
      // carrying only the generic construction fallback. Only fetched for those rows.
      shape: sql<GeoJSON.GeometryCollection | null>`CASE
        WHEN ${projects.geometry} IS NOT NULL AND (
          COALESCE(cardinality(${projects.tags}), 0) = 0
          OR ${projects.tags} = ARRAY['construction']::text[]
        )
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
    })
    .from(candidates)
    .innerJoin(projects, eq(projects.id, candidates.id))
    .orderBy(desc(candidates.updatedAt), desc(candidates.id));
}

type StandaloneProjectRow = Awaited<ReturnType<typeof buildStandaloneProjectsQuery>>[number];

function mapStandaloneProject(p: StandaloneProjectRow) {
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
  };
}

function overlayContributionDate(): SQL<Date> {
  return sql<Date>`GREATEST(${overlays.updatedAt}, ${projects.updatedAt})`;
}

function overlayProjectName(): SQL<string> {
  return sql<string>`COALESCE(${projects.name}, ${overlays.caption})`;
}

function overlayConditions(input: FeedInput): SQL[] {
  return [
    eq(overlays.status, "approved"),
    eq(projects.status, "approved"),
    eq(overlays.kind, "map"),
    ...projectFilterConditions(input),
    ...dateRangeConditions(
      input,
      sql`COALESCE(${projects.externalLastModified}, ${projects.updatedAt})`,
    ),
    ...overlayMapAreaConditions(input),
  ];
}

// One feed entry per project: the most recently updated approved overlay.
// DISTINCT ON (project) collapses a multi-overlay project to a single row so a
// batch approval can't bury every other contribution.
function buildLatestOverlaysQuery(
  limit: number,
  input: FeedInput,
  cursor: FeedStreamCursor | null | undefined,
) {
  const contributionDate = overlayContributionDate();
  const overlayName = overlayProjectName();

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
      projectId: overlays.projectId,
      lat: projects.lat,
      lng: projects.lng,
    })
    .from(overlays)
    .innerJoin(projects, eq(overlays.projectId, projects.id))
    .where(and(...overlayConditions(input)))
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
    projectId: o.projectId,
    lat: o.lat,
    lng: o.lng,
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
const COUNT_CACHE_MAX_ENTRIES = 128;
const contributionCountCache = new Map<string, { count: number; timestamp: number }>();
const pendingContributionCounts = new Map<string, Promise<number>>();
let feedCacheGeneration = 0;

export function invalidateLatestContributionsCache() {
  firstPageCache.clear();
  contributionCountCache.clear();
  feedCacheGeneration += 1;
}

function cacheKey(input: FeedPageInput): string | null {
  const isDefaultPage =
    !input.cursor &&
    input.tags.length === 0 &&
    !input.includeUntagged &&
    input.statuses.length === 0 &&
    input.minSizeM === undefined &&
    input.maxSizeM === undefined &&
    input.modifiedAfterMs === undefined &&
    input.modifiedBeforeMs === undefined &&
    input.named === undefined &&
    !input.onlyWithImages &&
    input.mapArea === undefined;
  return isDefaultPage ? `${input.source}|${input.limit}` : null;
}

function contributionCountCacheKey(input: FeedInput): string {
  return JSON.stringify({
    ...input,
    tags: input.tags.toSorted(),
    statuses: input.statuses.toSorted(),
  });
}

function cacheContributionCount(key: string, count: number, timestamp: number): void {
  contributionCountCache.delete(key);
  contributionCountCache.set(key, { count, timestamp });
  while (contributionCountCache.size > COUNT_CACHE_MAX_ENTRIES) {
    const oldestKey = contributionCountCache.keys().next().value;
    if (oldestKey === undefined) return;
    contributionCountCache.delete(oldestKey);
  }
}

function standaloneProjectCount(stream: StandaloneStream, input: FeedInput): SQL<number> {
  return sql<number>`(
    SELECT COUNT(*)::int
    FROM ${projects}
    WHERE ${and(...standaloneConditions(stream, input))}
  )`;
}

function overlayProjectCount(input: FeedInput): SQL<number> {
  return sql<number>`(
    SELECT COUNT(DISTINCT ${overlays.projectId})::int
    FROM ${overlays}
    INNER JOIN ${projects} ON ${overlays.projectId} = ${projects.id}
    WHERE ${and(...overlayConditions(input))}
  )`;
}

async function countLatestContributions(input: FeedInput): Promise<number> {
  const wantsCommunity = input.source !== "osm";
  const wantsImported = input.source !== "community";
  const countExpressions: SQL<number>[] = [];
  if (wantsCommunity) {
    countExpressions.push(overlayProjectCount(input), standaloneProjectCount("direct", input));
  }
  if (wantsImported) {
    countExpressions.push(standaloneProjectCount("imported", input));
  }

  const [row] = await db
    .select({ count: sql<number>`(${sql.join(countExpressions, sql` + `)})::int` })
    .from(sql`(SELECT 1) AS count_source`);
  return row?.count ?? 0;
}

async function getCachedContributionCount(input: FeedInput): Promise<number> {
  const key = contributionCountCacheKey(input);
  const now = Date.now();
  const hit = contributionCountCache.get(key);
  if (hit && now - hit.timestamp < CACHE_TTL) {
    contributionCountCache.delete(key);
    contributionCountCache.set(key, hit);
    return hit.count;
  }

  const generation = feedCacheGeneration;
  const pendingKey = `${generation}|${key}`;
  let pending = pendingContributionCounts.get(pendingKey);
  if (!pending) {
    pending = countLatestContributions(input);
    pendingContributionCounts.set(pendingKey, pending);
  }

  try {
    const count = await pending;
    if (generation === feedCacheGeneration) {
      cacheContributionCount(key, count, now);
    }
    return count;
  } finally {
    if (pendingContributionCounts.get(pendingKey) === pending) {
      pendingContributionCounts.delete(pendingKey);
    }
  }
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

  getContributionCount: publicProcedure.input(feedQuerySchema).query(async ({ input }) => {
    try {
      return { count: await getCachedContributionCount(input) };
    } catch (error) {
      console.error("Error in getContributionCount:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to count contributions",
        cause: error,
      });
    }
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
            item: mapStandaloneProject(p),
          })),
          ...importedRows.map((p) => ({
            stream: "imported" as const,
            item: mapStandaloneProject(p),
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
