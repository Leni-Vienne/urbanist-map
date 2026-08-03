import { sql, eq, and, inArray, getTableColumns, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, type Database } from "../database";
import {
  projects,
  overlays,
  adminBoundaries,
  changeRequests,
  users,
  userReports,
  importSources,
  type ApprovalStatus,
} from "./schema";
import type { AppMode } from "@shared/types";
import { buildProjectSlug } from "@shared/projectSlug";

// Build a permanent slug for a user-created project and resolve the (near-impossible) collision
// against the unique constraint by appending -2, -3, ... The bulk OSM import skips this check: its
// suffix derives from the globally-unique external id, so collisions can't occur there.
export async function generateUniqueProjectSlug(input: {
  name: string | null | undefined;
  id: string;
}): Promise<string> {
  const base = buildProjectSlug({ name: input.name, externalId: null, id: input.id });
  let candidate = base;
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
    candidate = `${base}-${attempt}`;
  }
  // Exhausting 100 attempts is impossible in practice; fall back to the uuid-suffixed base.
  return base;
}

// Country display name resolved from the level-2 (country) admin boundary matching a project's
// country_code. Replaces the former join to the dropped `countries` table.
// The outer column is written qualified: a drizzle column reference is emitted bare in a
// join-free query, and a bare `country_code` inside the subquery binds to `ab`, matching every row.
export const countryNameSql = sql<
  string | null
>`(SELECT ab.name FROM admin_boundaries ab WHERE ab.admin_level = 2 AND ab.country_code = "projects"."country_code" LIMIT 1)`;

// Full administrative breadcrumb (deepest boundary up to the country), deepest-first, mirroring
// project.getById's resolveBoundaryPath so list views render the same location as the detail panel.
// Walks the parent chain from the project's assigned boundary; each entry ships every name variant
// so the client picks by locale. NULL boundary or no chain yields []. The depth guard stops a
// malformed parent cycle from looping forever.
const boundaryPathSql = sql<
  {
    name: string;
    nameEn: string | null;
    names: Record<string, string> | null;
    adminLevel: number;
  }[]
>`COALESCE((
  WITH RECURSIVE chain AS (
    SELECT osm_id, parent_id, name, name_en, names, admin_level, 1 AS depth
    FROM admin_boundaries
    WHERE osm_id = "projects"."admin_boundary_id"
    UNION ALL
    SELECT ab.osm_id, ab.parent_id, ab.name, ab.name_en, ab.names, ab.admin_level, c.depth + 1
    FROM admin_boundaries ab
    JOIN chain c ON ab.osm_id = c.parent_id
    WHERE c.depth < 12
  )
  SELECT json_agg(
    json_build_object('name', name, 'nameEn', name_en, 'names', names, 'adminLevel', admin_level)
    ORDER BY admin_level DESC
  )
  FROM chain
), '[]'::json)`;

// Name variants of one boundary. Shipping every locale the UI can render, rather than a single
// resolved name, keeps a response free of a locale param and its cached pages locale-agnostic.
export type LocalizedBoundaryName = {
  name: string; // OSM `name` (usually local language)
  nameEn: string | null; // OSM `name:en`
  names: Record<string, string> | null; // `name:*` variants for BOUNDARY_NAME_LOCALES
};

// Locales whose OSM `name:<code>` variant reaches the client; must cover the app's selectable UI
// locales, minus English, which travels as nameEn. A boundary carries up to ~260 `name:*` variants
// (France alone), so this projection is worth kilobytes per row. An omitted locale falls back to
// the English or native name.
const BOUNDARY_NAME_LOCALES = ["fr"];

// Binds one param per element, so the value reaches Postgres as an array rather than as a
// comma-separated parameter list.
export function textArray(values: string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

// Location source for a project, resolved by walking its assigned admin boundary's parent_id chain
// (projects.admin_boundary_id -> admin_boundaries). `pick` maps to an OSM admin_level bucket:
//   city    -> deepest of 6..8 (prefers the municipality at 8, e.g. Montréal/Paris; falls back to a
//              county at 6 where no level-8 exists).
//   state   -> level 4 exactly: the canonical province/region (Québec, Ontario, Île-de-France).
//              Odd levels are informal groupings we must skip (5 = "Golden Horseshoe", 3 = "France
//              métropolitaine").
//   country -> level 2.
// Returns NULL when the project has no assigned boundary or the chain lacks that grade.
// The outer column is written qualified for the reason given on countryNameSql.
export function boundaryName(
  pick: "city" | "state" | "country",
): SQL<LocalizedBoundaryName | null> {
  const range = {
    city: sql`admin_level BETWEEN 6 AND 8`,
    state: sql`admin_level = 4`,
    country: sql`admin_level = 2`,
  }[pick];
  return sql<LocalizedBoundaryName | null>`(
    WITH RECURSIVE chain AS (
      SELECT osm_id, parent_id, admin_level, name, name_en, names
      FROM ${adminBoundaries} WHERE osm_id = "projects"."admin_boundary_id"
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

interface PaginationFilters {
  countryCode?: string;
  cursor?: string;
}

export async function buildPaginationConditions(
  filters: PaginationFilters,
  sortColumn: PgColumn,
): Promise<SQL[]> {
  const conditions: SQL[] = [];

  if (filters.countryCode) {
    conditions.push(eq(projects.countryCode, filters.countryCode));
  }

  // Cursor-based pagination: fetch records after the cursor position
  if (filters.cursor) {
    const cursorProject = await db
      .select({ sortValue: sortColumn })
      .from(projects)
      .where(eq(projects.id, filters.cursor))
      .limit(1);

    const cursorValue = cursorProject[0];
    if (cursorValue) {
      // Composite keyset boundary: the sort column (createdAt/updatedAt) is not unique
      // (batch imports and bulk approvals share a timestamp), so a bare `< sortValue` would
      // skip every row tied with the cursor. Tie-break on the unique project id. Must match
      // the DESC ordering at every call site (sortColumn DESC, id DESC).
      conditions.push(
        sql`(${sortColumn} < ${cursorValue.sortValue}
             OR (${sortColumn} = ${cursorValue.sortValue} AND ${projects.id} < ${filters.cursor}::uuid))`,
      );
    }
  }

  return conditions;
}

export function buildPaginationResponse<T extends { id: string }>(
  results: T[],
  limit: number,
): {
  items: T[];
  pagination: { nextCursor: string | null; hasMore: boolean };
} {
  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;
  const lastItem = items[items.length - 1];

  return {
    items,
    pagination: {
      nextCursor: hasMore && lastItem ? lastItem.id : null,
      hasMore,
    },
  };
}

// PostGIS geometry extracted as JSON for corners and centroid
const overlaySelectFields = {
  id: overlays.id,
  version: overlays.version,
  filename: overlays.filename,
  caption: overlays.caption,
  status: overlays.status,
  kind: overlays.kind,
  projectId: overlays.projectId,
  authorId: overlays.authorId,
  replacesOverlayId: overlays.replacesOverlayId,
  replacedByOverlayId: overlays.replacedByOverlayId,
  // Extract corners from polygon geometry as array of {lat, lng}
  corners: sql<{ lat: number; lng: number }[]>`
    (SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
     FROM ST_DumpPoints(${overlays.corners}) AS dump(path, geom)
     WHERE path[2] <= 4)
  `,
  centroid: sql<{ lat: number; lng: number }>`
    json_build_object('lat', ST_Y(${overlays.centroid}), 'lng', ST_X(${overlays.centroid}))
  `,
  createdAt: overlays.createdAt,
  updatedAt: overlays.updatedAt,
  projectName: projects.name,
  countryCode: projects.countryCode,
  countryName: countryNameSql,
};

export function buildOverlayQuery(database: Database) {
  return database
    .select(overlaySelectFields)
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id));
}

// Project fields returned to frontend project consumers.
export const PROJECT_COLUMNS = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  status: projects.status,
  version: projects.version,
  ownerId: projects.ownerId,
  timelineStatus: projects.timelineStatus,
  importSourceId: projects.importSourceId,
  externalId: projects.externalId,
  externalProperties: projects.externalProperties,
  externalLastModified: projects.externalLastModified,
  lat: projects.lat,
  lng: projects.lng,
  proposalDate: projects.proposalDate,
  proposalDatePrecision: projects.proposalDatePrecision,
  startDate: projects.startDate,
  startDatePrecision: projects.startDatePrecision,
  endDate: projects.endDate,
  endDatePrecision: projects.endDatePrecision,
  sourceUrl: projects.sourceUrl,
  tags: projects.tags,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
  geometry: sql<GeoJSON.GeometryCollection | null>`CASE WHEN ${projects.geometry} IS NULL THEN NULL ELSE ST_AsGeoJSON(${projects.geometry})::json END`,
  geometrySizeM: projects.geometrySizeM,
  countryCode: projects.countryCode,
} as const;

export function buildProjectWithLocationQuery(database: Database) {
  return database
    .select({
      ...PROJECT_COLUMNS,
      countryName: countryNameSql,
      boundaryPath: boundaryPathSql,
      importSource: importSources,
    })
    .from(projects)
    .leftJoin(importSources, eq(importSources.id, projects.importSourceId));
}

/**
 * Build overlay query with minimal fields for moderation lists
 * Includes location data but not full geometry extraction
 */
export function buildOverlayModerationQuery(database: Database) {
  return database
    .select({
      id: overlays.id,
      caption: overlays.caption,
      filename: overlays.filename,
      status: overlays.status,
      kind: overlays.kind,
      version: overlays.version,
      projectId: overlays.projectId,
      authorId: overlays.authorId,
      authorUsername: users.username,
      authorApprovedCount: users.approvedCount,
      authorRejectedCount: users.rejectedCount,
      replacesOverlayId: overlays.replacesOverlayId,
      replacedByOverlayId: overlays.replacedByOverlayId,
      updatedAt: overlays.updatedAt,
      countryCode: projects.countryCode,
      countryName: countryNameSql,
    })
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .leftJoin(users, eq(overlays.authorId, users.id));
}

export function buildProjectModerationQuery(database: Database) {
  const { geometry: _geometry, ...columnsWithoutGeometry } = PROJECT_COLUMNS;
  return database
    .select({
      ...columnsWithoutGeometry,
      ownerUsername: users.username,
      ownerApprovedCount: users.approvedCount,
      ownerRejectedCount: users.rejectedCount,
      countryName: countryNameSql,
    })
    .from(projects)
    .leftJoin(users, eq(projects.ownerId, users.id));
}

interface ConflictableChange {
  entityType: string;
  entityId: string;
  fieldName: string;
}

// Sets hasConflict: true when 2+ pending changes target the same entity+field
export function addConflictFlags<T extends ConflictableChange>(
  changes: T[],
): (T & { hasConflict: boolean })[] {
  const conflictMap = new Map<string, number>();

  for (const change of changes) {
    const key = `${change.entityType}:${change.entityId}:${change.fieldName}`;
    conflictMap.set(key, (conflictMap.get(key) ?? 0) + 1);
  }

  return changes.map((change) => {
    const key = `${change.entityType}:${change.entityId}:${change.fieldName}`;
    return { ...change, hasConflict: (conflictMap.get(key) ?? 0) > 1 };
  });
}

// Type for user context from tRPC (can be undefined or null)
type UserContext =
  | {
      id: string;
      role?: string | null;
      moderatedCountries?: string[] | null;
    }
  | undefined
  | null;

// Fetch overlay IDs where the user has an OPEN (pending/conflicted) change request.
export async function getUserOverlayChangeRequestIds(
  database: Database,
  userId: string,
): Promise<string[]> {
  const changeRequestResults = await database
    .selectDistinct({ overlayId: changeRequests.entityId })
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.requestedBy, userId),
        eq(changeRequests.entityType, "overlay"),
        inArray(changeRequests.status, ["pending", "conflicted"]),
      ),
    );

  return changeRequestResults.map((r) => r.overlayId);
}

// Fetch overlay IDs with an OPEN (pending/conflicted) change request from ANY requester.
export async function getAllOpenOverlayChangeRequestIds(database: Database): Promise<string[]> {
  const changeRequestResults = await database
    .selectDistinct({ overlayId: changeRequests.entityId })
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.entityType, "overlay"),
        inArray(changeRequests.status, ["pending", "conflicted"]),
      ),
    );

  return changeRequestResults.map((r) => r.overlayId);
}

// Build WHERE condition for project visibility based on user context and map mode
export function buildProjectVisibilityCondition(
  user: UserContext,
  mode: AppMode,
  strictModeration = true,
): SQL {
  if (mode === "view") {
    // View mode: only show approved projects
    return eq(projects.status, "approved");
  }

  if (mode === "edit" && user) {
    // Edit mode: show approved projects OR user's own projects (any status)
    return sql`(${projects.status} = 'approved' OR ${projects.ownerId} = ${user.id})`;
  }

  if (mode === "moderation" && user) {
    // If strict moderation is disabled, show approved projects for context
    // This is useful for map views where moderators need to see surrounding approved content
    if (!strictModeration) {
      return sql`(${projects.status} = 'approved' OR ${projects.status} = 'pending')`;
    }

    // Moderation mode (strict): only show projects that need moderation
    // This includes: pending projects OR projects with pending overlays OR projects with pending change requests
    // Excludes: approved projects with only approved content and no pending changes
    return sql`
      ${projects.id} IN (
        SELECT ${projects.id} FROM ${projects} WHERE ${projects.status} = 'pending'
        UNION
        SELECT ${overlays.projectId} FROM ${overlays} WHERE ${overlays.status} = 'pending'
        UNION
        SELECT ${changeRequests.entityId} FROM ${changeRequests} WHERE ${changeRequests.entityType} = 'project' AND ${changeRequests.status} = 'pending'
        UNION
        SELECT ${overlays.projectId} FROM ${changeRequests} JOIN ${overlays} ON ${changeRequests.entityId} = ${overlays.id} WHERE ${changeRequests.entityType} = 'overlay' AND ${changeRequests.status} = 'pending'
      )
    `;
  }

  // Default (anonymous or unrecognized mode): only show approved projects
  return eq(projects.status, "approved");
}

// Build WHERE condition for overlay visibility based on user context and map mode
// Can also handle admin includeStatus filter (takes precedence over mode logic)
export function buildOverlayVisibilityCondition(
  user: UserContext,
  mode: AppMode,
  overlayChangeRequestIds?: string[],
  adminIncludeStatus?: ApprovalStatus[],
): SQL {
  // Admin status filter takes precedence
  if (adminIncludeStatus && user?.role === "admin" && adminIncludeStatus.length > 0) {
    return inArray(overlays.status, adminIncludeStatus);
  }

  if (mode === "view") {
    // View mode: only show approved overlays
    return eq(overlays.status, "approved");
  }

  if (mode === "edit" && user) {
    // Edit mode: show approved overlays OR user's own PENDING overlays OR overlays with user's change requests
    // Rejected and replaced overlays are NOT shown even if user owns them
    if (overlayChangeRequestIds && overlayChangeRequestIds.length > 0) {
      const idsArray = `{${overlayChangeRequestIds.join(",")}}`;
      return sql`(
        ${overlays.status} = 'approved'
        OR (${overlays.authorId} = ${user.id} AND ${overlays.status} = 'pending')
        OR ${overlays.id} = ANY(${idsArray}::uuid[])
      )`;
    } else {
      return sql`(${overlays.status} = 'approved' OR (${overlays.authorId} = ${user.id} AND ${overlays.status} = 'pending'))`;
    }
  }

  if (mode === "moderation" && user) {
    // Moderation mode: show ALL overlays (approved + pending) for review
    return sql`(${overlays.status} = 'approved' OR ${overlays.status} = 'pending')`;
  }

  // Default (anonymous or unrecognized mode): only show approved overlays
  return eq(overlays.status, "approved");
}

// The caller's own open overlay change requests, grouped by overlay id.
async function fetchOwnOverlayChangeRequests(user: UserContext): Promise<
  Map<
    string,
    {
      fieldName: string;
      newValue: unknown;
    }[]
  >
> {
  const changeRequestsByOverlay = new Map<string, { fieldName: string; newValue: unknown }[]>();
  if (!user) return changeRequestsByOverlay;

  const changeRequestsData = await db
    .select({
      entityId: changeRequests.entityId,
      fieldName: changeRequests.fieldName,
      newValue: changeRequests.newValue,
    })
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.requestedBy, user.id),
        eq(changeRequests.entityType, "overlay"),
        eq(changeRequests.status, "pending"),
      ),
    );

  for (const cr of changeRequestsData) {
    const existing = changeRequestsByOverlay.get(cr.entityId) ?? [];
    existing.push({ fieldName: cr.fieldName, newValue: cr.newValue });
    changeRequestsByOverlay.set(cr.entityId, existing);
  }

  return changeRequestsByOverlay;
}

function transformOverlayDataWithChangeRequests(
  overlaysData: Awaited<ReturnType<typeof fetchOverlaysWithLocation>>,
  changeRequestsByOverlay: Map<
    string,
    {
      fieldName: string;
      newValue: unknown;
    }[]
  >,
) {
  return overlaysData.map((row) => {
    const approvedCorners = row.corners;
    const centroid = { lat: row.centroidLat, lng: row.centroidLng };

    const overlayChangeRequests = changeRequestsByOverlay.get(row.overlayId) ?? [];

    const cornersChangeRequest = overlayChangeRequests.find((cr) => cr.fieldName === "corners");
    /* oxlint-disable no-unsafe-type-assertion */
    const suggestedCorners = cornersChangeRequest?.newValue
      ? (cornersChangeRequest.newValue as { lat: number; lng: number }[])
      : null;
    /* oxlint-enable */

    const captionChangeRequest = overlayChangeRequests.find((cr) => cr.fieldName === "caption");
    const suggestedCaption =
      captionChangeRequest &&
      captionChangeRequest.newValue !== null &&
      captionChangeRequest.newValue !== undefined
        ? String(captionChangeRequest.newValue)
        : null;

    return {
      id: row.overlayId,
      version: row.overlayVersion,
      filename: row.overlayFilename,
      caption: row.overlayCaption,
      status: row.overlayStatus,
      projectId: row.overlayProjectId,
      authorId: row.overlayAuthorId,
      replacesOverlayId: row.overlayReplacesOverlayId,
      replacedByOverlayId: row.overlayReplacedByOverlayId ?? null,
      createdAt: row.overlayCreatedAt,
      updatedAt: row.overlayUpdatedAt,
      centroid,
      corners: approvedCorners,
      suggestedCorners: suggestedCorners ?? undefined,
      suggestedCaption: suggestedCaption ?? undefined,
      project: {
        ...row.project,
        importSource: row.importSource,
      },
      hasPendingChanges: overlayChangeRequests.length > 0,
    };
  });
}

export async function fetchOverlaysWithLocation(whereConditions: SQL[]) {
  return await db
    .select({
      overlayId: overlays.id,
      overlayVersion: overlays.version,
      overlayFilename: overlays.filename,
      overlayCaption: overlays.caption,
      overlayStatus: overlays.status,
      overlayProjectId: overlays.projectId,
      overlayAuthorId: overlays.authorId,
      overlayReplacesOverlayId: overlays.replacesOverlayId,
      overlayReplacedByOverlayId: overlays.replacedByOverlayId,
      overlayCreatedAt: overlays.createdAt,
      overlayUpdatedAt: overlays.updatedAt,
      centroidLat: sql<number>`ST_Y(${overlays.centroid})`,
      centroidLng: sql<number>`ST_X(${overlays.centroid})`,
      corners: sql<{ lat: number; lng: number }[]>`(
        SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
        FROM ST_DumpPoints(${overlays.corners}) AS dump(path, geom)
        WHERE path[2] <= 4
      )`,
      project: {
        ...getTableColumns(projects),
        geometry: sql<GeoJSON.GeometryCollection | null>`CASE WHEN ${projects.geometry} IS NULL THEN NULL ELSE ST_AsGeoJSON(${projects.geometry})::json END`,
      },
      importSource: importSources,
    })
    .from(overlays)
    .innerJoin(projects, eq(projects.id, overlays.projectId))
    .leftJoin(importSources, eq(importSources.id, projects.importSourceId))
    // Renders are not georeferenced (null corners), so they never appear on the map.
    .where(and(eq(overlays.kind, "map"), ...whereConditions))
    .orderBy(overlays.createdAt);
}

// Fetch overlays matching the given WHERE conditions and shape them for map rendering, merging in
// the caller's own open change requests (never another requester's, whatever mode is asking).
export async function fetchOverlaysForMap(whereConditions: SQL[], user: UserContext) {
  const overlaysData = await fetchOverlaysWithLocation(whereConditions);
  const changeRequestsByOverlay = await fetchOwnOverlayChangeRequests(user);

  return transformOverlayDataWithChangeRequests(overlaysData, changeRequestsByOverlay);
}

import { TRPCError } from "@trpc/server";

export function isModeratorOrAdmin(user: UserContext): boolean {
  if (!user) return false;

  const isAdmin = user.role === "admin";
  const isModerator =
    user.moderatedCountries !== null &&
    user.moderatedCountries !== undefined &&
    user.moderatedCountries.length > 0;

  return isAdmin || isModerator;
}

/**
 * Checks if a user has moderator or admin access for moderation mode
 * Throws TRPCError if user doesn't have required permissions
 */
export function requireModeratorAccess(user: UserContext, mode: AppMode): void {
  if (mode !== "moderation") {
    return;
  }

  if (!user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required for moderation mode",
    });
  }

  if (!isModeratorOrAdmin(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Moderator or admin access required for moderation mode",
    });
  }
}

// Blocked if banned OR reported by >= threshold distinct moderators.
export async function isUserBlocked(userId: string): Promise<boolean> {
  try {
    const userResult = await db
      .select({ banned: users.banned })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = userResult[0];
    if (!user || user.banned) return true;

    // Get report threshold from config (default to 2)
    const configResult = await db
      .select({ reportThreshold: sql<number>`coalesce(report_threshold, 2)` })
      .from(sql`config`)
      .limit(1);

    const threshold = configResult[0]?.reportThreshold ?? 2;

    // Count how many distinct moderators have reported this user
    const reportCountResult = await db
      .select({ count: sql<number>`count(distinct ${userReports.reportedBy})::int` })
      .from(userReports)
      .where(eq(userReports.reportedUserId, userId))
      .limit(1);

    const reportCount = reportCountResult[0]?.count ?? 0;

    // Block if report count meets or exceeds threshold
    return reportCount >= threshold;
  } catch (error) {
    console.error("Error checking if user is blocked:", error);
    // Default to blocking on error for safety
    return true;
  }
}
