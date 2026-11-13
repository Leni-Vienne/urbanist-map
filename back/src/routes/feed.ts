import { publicProcedure, router, TRPCError } from "../trpc";
import { z } from "zod";
import { db } from "../database";
import { overlays, projects } from "../db/schema";
import { sql, eq, and, or, desc, type SQL } from "drizzle-orm";
import { boundaryName, textArray } from "../db/helpers";

// One row per project makes its UUID a unique tie-breaker across all contribution sources.
const feedCursorSchema = z.object({
  date: z.iso.datetime(),
  projectId: z.uuid(),
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

function imageMapAreaConditions(input: FeedInput): SQL[] {
  if (!input.mapArea) return [];
  const area = input.mapArea;
  return [
    sql`(
      (${overlays.kind} = 'map' AND ${intersectsMapArea(sql`${overlays.corners}`, area)})
      OR (${overlays.kind} = 'render' AND (
        ${intersectsMapArea(sql`${projects.geometry}`, area)}
        OR ${intersectsMapArea(sql`${projects.centerCoordinate}`, area)}
      ))
    )`,
  ];
}

// Keyset predicate. Row comparison orders by date then id, matching the ORDER BY, so rows sharing
// a timestamp are still split at an exact position.
function keysetCondition(
  dateExpr: SQL,
  idExpr: SQL | typeof projects.id,
  cursor: FeedPageInput["cursor"],
): SQL[] {
  if (!cursor) return [];
  return [sql`(${dateExpr}, ${idExpr}) < (${cursor.date}::timestamptz, ${cursor.projectId}::uuid)`];
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
  cursor?: FeedPageInput["cursor"],
): SQL[] {
  const contributionDate = standaloneContributionDate(stream);
  const conditions: SQL[] = [
    sql`${projects.status} = 'approved'`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${overlays}
      WHERE ${overlays.projectId} = ${projects.id}
      AND ${overlays.status} = 'approved'
      AND ${overlays.kind} IN ('map', 'render')
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
    conditions.push(sql`FALSE`);
  }

  return conditions;
}

// Both standalone and image rows navigate to the project's full geometry when available.
function projectGeometryBbox() {
  return sql<{
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null>`CASE WHEN ${projects.geometry} IS NOT NULL AND NOT ST_IsEmpty(${projects.geometry}) THEN json_build_object(
    'minLat', ST_YMin(ST_Envelope(${projects.geometry})),
    'maxLat', ST_YMax(ST_Envelope(${projects.geometry})),
    'minLng', ST_XMin(ST_Envelope(${projects.geometry})),
    'maxLng', ST_XMax(ST_Envelope(${projects.geometry}))
  ) ELSE NULL END`.as("geometryBbox");
}

// Limit each indexed branch before merging; hydrate location and geometry only for the final page.
function standaloneCandidates(stream: StandaloneStream, input: FeedPageInput) {
  const contributionDate = standaloneContributionDate(stream);
  const enabled = stream === "direct" ? input.source !== "osm" : input.source !== "community";
  return db
    .select({
      projectId: projects.id,
      overlayId: sql<string | null>`NULL::uuid`.as("overlayId"),
      updatedAt: contributionDate.as("updatedAt"),
    })
    .from(projects)
    .where(
      and(...standaloneConditions(stream, input, input.cursor), enabled ? undefined : sql`FALSE`),
    )
    .orderBy(sql`${contributionDate} DESC, ${projects.id} DESC`)
    .limit(input.limit + 1);
}

function imageConditions(input: FeedInput): SQL[] {
  return [
    eq(overlays.status, "approved"),
    eq(projects.status, "approved"),
    sql`${overlays.kind} IN ('map', 'render')`,
    ...projectFilterConditions(input),
    ...dateRangeConditions(
      input,
      sql`COALESCE(${projects.externalLastModified}, ${projects.updatedAt})`,
    ),
    ...imageMapAreaConditions(input),
  ];
}

// Choose the latest approved image before applying the cursor, so an older image from the
// same project cannot reappear on a later page. UUID breaks ties between equally recent images.
function imageCandidates(input: FeedPageInput) {
  const latestImagePerProject = db
    .selectDistinctOn([overlays.projectId], {
      projectId: projects.id,
      overlayId: sql<string | null>`${overlays.id}`.as("overlayId"),
      updatedAt: sql<Date>`GREATEST(${overlays.updatedAt}, ${projects.updatedAt})`.as("updatedAt"),
    })
    .from(overlays)
    .innerJoin(projects, eq(overlays.projectId, projects.id))
    .where(and(...imageConditions(input), input.source === "osm" ? sql`FALSE` : undefined))
    .orderBy(overlays.projectId, desc(overlays.updatedAt), desc(overlays.id))
    .as("latest_image_per_project");

  return db
    .select()
    .from(latestImagePerProject)
    .where(
      and(
        ...keysetCondition(
          sql`${latestImagePerProject.updatedAt}`,
          sql`${latestImagePerProject.projectId}`,
          input.cursor,
        ),
      ),
    )
    .orderBy(desc(latestImagePerProject.updatedAt), desc(latestImagePerProject.projectId))
    .limit(input.limit + 1);
}

export function buildFeedQuery(input: FeedPageInput) {
  const candidates = standaloneCandidates("direct", input)
    .unionAll(standaloneCandidates("imported", input))
    .unionAll(imageCandidates(input))
    .as("feed_candidates");
  const page = db
    .select()
    .from(candidates)
    .orderBy(desc(candidates.updatedAt), desc(candidates.projectId))
    .limit(input.limit + 1)
    .as("feed_page");

  return db
    .select({
      projectId: sql<string>`${projects.id}`.as("projectId"),
      name: sql<string | null>`COALESCE(${projects.name}, ${overlays.caption})`.as("name"),
      updatedAt: page.updatedAt,
      // Keep PostgreSQL microseconds: converting through Date would skip rows within the same ms.
      cursorDate:
        sql<string>`to_char(${page.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          "cursorDate",
        ),
      city: boundaryName("city"),
      state: boundaryName("state"),
      countryCode: projects.countryCode,
      country: boundaryName("country"),
      tags: projects.tags,
      shape: sql<GeoJSON.GeometryCollection | null>`CASE
        WHEN ${page.overlayId} IS NULL AND ${projects.geometry} IS NOT NULL AND (
          COALESCE(cardinality(${projects.tags}), 0) = 0
          OR ${projects.tags} = ARRAY['construction']::text[]
        )
        THEN ST_AsGeoJSON(ST_Simplify(${projects.geometry}, 0.00003), 5)::json
        ELSE NULL
      END`,
      lat: projects.lat,
      lng: projects.lng,
      geometryBbox: projectGeometryBbox(),
      image: { id: overlays.id, filename: overlays.filename, kind: overlays.kind },
    })
    .from(page)
    .innerJoin(projects, eq(projects.id, page.projectId))
    .leftJoin(overlays, eq(overlays.id, page.overlayId))
    .orderBy(desc(page.updatedAt), desc(page.projectId));
}

function mapContribution(row: Awaited<ReturnType<typeof buildFeedQuery>>[number]) {
  const { image, projectId, cursorDate: _cursorDate, shape, ...project } = row;
  const common = { ...project, tags: project.tags ?? [] };
  return image
    ? { ...common, type: "overlay" as const, ...image, projectId }
    : { ...common, type: "standalone" as const, id: projectId, filename: null, shape };
}

type FeedPage = {
  items: ReturnType<typeof mapContribution>[];
  nextCursor: z.infer<typeof feedCursorSchema> | null;
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

function imageProjectCount(input: FeedInput): SQL<number> {
  return sql<number>`(
    SELECT COUNT(DISTINCT ${overlays.projectId})::int
    FROM ${overlays}
    INNER JOIN ${projects} ON ${overlays.projectId} = ${projects.id}
    WHERE ${and(...imageConditions(input))}
  )`;
}

async function countLatestContributions(input: FeedInput): Promise<number> {
  const wantsCommunity = input.source !== "osm";
  const wantsImported = input.source !== "community";
  const countExpressions: SQL<number>[] = [];
  if (wantsCommunity) {
    countExpressions.push(imageProjectCount(input), standaloneProjectCount("direct", input));
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

export const feedRouter = router({
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
        const generation = feedCacheGeneration;
        const key = cacheKey(input);
        if (key) {
          const hit = firstPageCache.get(key);
          if (hit && now - hit.timestamp < CACHE_TTL) {
            return hit.page;
          }
        }

        const rows = await buildFeedQuery(input);
        const items = rows.slice(0, input.limit);
        const last = items.at(-1);
        const page: FeedPage = {
          items: items.map(mapContribution),
          nextCursor:
            rows.length > input.limit && last
              ? { date: last.cursorDate, projectId: last.projectId }
              : null,
        };

        if (key && generation === feedCacheGeneration) {
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
