import { sql, eq, and, inArray, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { db } from '../database';
import { projects, cities, overlays, countries, changeRequests } from './schema';

// AI : ============================================================================
// AI : DATABASE HELPERS - Unified utilities for pagination, queries, and visibility
// AI : ============================================================================
// AI : Combines pagination, query builders, and visibility helpers to eliminate
// AI : duplication and provide single source of truth for database operations
// AI : ============================================================================

// AI : ============================================================================
// AI : PAGINATION HELPERS
// AI : ============================================================================

/**
 * AI : Standard pagination input filters used across multiple endpoints
 */
export interface PaginationFilters {
  cityId?: string;
  countryCode?: string;
  cursor?: string;
}

/**
 * AI : Build common filter conditions for pagination queries
 * AI : Adds cityId, countryCode, and cursor-based pagination conditions
 *
 * @param filters - Object containing optional cityId, countryCode, and cursor
 * @param sortColumn - The column used for sorting (determines cursor comparison)
 * @returns Array of SQL conditions to be used in where clauses
 */
export async function buildPaginationConditions(
  filters: PaginationFilters,
  sortColumn: PgColumn
): Promise<SQL[]> {
  const conditions: SQL[] = [];

  if (filters.cityId) {
    conditions.push(eq(projects.cityId, filters.cityId));
  }

  if (filters.countryCode) {
    conditions.push(eq(cities.countryCode, filters.countryCode));
  }

  // AI : Cursor-based pagination: fetch records after the cursor position
  if (filters.cursor) {
    const cursorProject = await db
      .select({ sortValue: sortColumn })
      .from(projects)
      .where(eq(projects.id, filters.cursor))
      .limit(1);

    if (cursorProject.length > 0) {
      conditions.push(sql`${sortColumn} < ${cursorProject[0].sortValue}`);
    }
  }

  return conditions;
}

/**
 * AI : Build pagination response with nextCursor and hasMore flag
 *
 * @param results - Array of query results
 * @param limit - The requested limit
 * @returns Object with paginated items and pagination metadata
 */
export function buildPaginationResponse<T extends { id: string }>(
  results: T[],
  limit: number
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
      hasMore
    }
  };
}

// AI : ============================================================================
// AI : QUERY BUILDERS
// AI : ============================================================================

/**
 * AI : Select fields for overlay queries with full location hierarchy
 * AI : Extracts PostGIS geometry as JSON for corners and centroid
 */
export const overlaySelectFields = {
  id: overlays.id,
  version: overlays.version,
  filename: overlays.filename,
  caption: overlays.caption,
  status: overlays.status,
  projectId: overlays.projectId,
  authorId: overlays.authorId,
  replacesOverlayId: overlays.replacesOverlayId,
  // AI : Extract corners from polygon geometry as array of {lat, lng}
  corners: sql<{lat: number, lng: number}[]>`
    (SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
     FROM ST_DumpPoints(${overlays.corners}) AS dump(path, geom)
     WHERE path[2] <= 4)
  `,
  // AI : Extract centroid as {lat, lng}
  centroid: sql<{lat: number, lng: number}>`
    json_build_object('lat', ST_Y(${overlays.centroid}), 'lng', ST_X(${overlays.centroid}))
  `,
  createdAt: overlays.createdAt,
  updatedAt: overlays.updatedAt,
  projectName: projects.name,
  cityName: cities.name,
  cityId: cities.id,
  countryCode: countries.code,
  countryName: countries.name,
};

/**
 * AI : Build overlay query with full location joins (overlay -> project -> city -> country)
 * AI : Returns chainable query that can be extended with .where(), .orderBy(), .limit()
 */
export function buildOverlayQuery(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select(overlaySelectFields)
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .innerJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}

/**
 * AI : Build project query with city and country location data
 * AI : Returns chainable query that can be extended with .where(), .orderBy(), .limit()
 */
export function buildProjectWithLocationQuery(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      version: projects.version,
      ownerId: projects.ownerId,
      cityId: projects.cityId,
      isDevelopment: projects.isDevelopment,
      lat: projects.lat,
      lng: projects.lng,
      proposalDate: projects.proposalDate,
      startDate: projects.startDate,
      endDate: projects.endDate,
      sourceUrl: projects.sourceUrl,
      latestUpdateOn: projects.latestUpdateOn,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      cityName: cities.name,
      countryCode: countries.code,
      countryName: countries.name,
      city: cities
    })
    .from(projects)
    .innerJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}

/**
 * AI : Build overlay query with minimal fields for moderation lists
 * AI : Includes location data but not full geometry extraction
 */
export function buildOverlayModerationQuery(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select({
      id: overlays.id,
      name: sql<string>`coalesce(${overlays.caption}, 'Unnamed')`,
      filename: overlays.filename,
      status: overlays.status,
      version: overlays.version,
      projectId: overlays.projectId,
      updatedAt: overlays.updatedAt,
      cityId: cities.id,
      cityName: cities.name,
      countryCode: countries.code,
      countryName: countries.name,
    })
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .innerJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}

/**
 * AI : Build project query with minimal fields for moderation lists
 */
export function buildProjectModerationQuery(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      version: projects.version,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      startDate: projects.startDate,
      endDate: projects.endDate,
      sourceUrl: projects.sourceUrl,
      isDevelopment: projects.isDevelopment,
      lat: projects.lat,
      lng: projects.lng,
      cityId: projects.cityId,
      cityName: cities.name,
      countryCode: countries.code,
      countryName: countries.name,
    })
    .from(projects)
    .innerJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}

// AI : ============================================================================
// AI : VISIBILITY HELPERS
// AI : ============================================================================

// AI : Type for user context from tRPC (can be undefined or null)
export type UserContext = {
  id: string;
  role?: string | null;
} | undefined | null;

// AI : Type for map viewing modes
export type MapMode = 'view' | 'edit' | 'moderation';

// AI : Type for approval status
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

// AI : Fetch overlay IDs where user has pending change requests
export async function getUserOverlayChangeRequestIds(
  db: PostgresJsDatabase<typeof schema>,
  userId: string
): Promise<string[]> {
  const changeRequestResults = await db
    .selectDistinct({ overlayId: changeRequests.entityId })
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.requestedBy, userId),
        eq(changeRequests.entityType, 'overlay')
      )
    );

  return changeRequestResults
    .map(r => r.overlayId)
    .filter((id): id is string => id !== null);
}

// AI : Build WHERE condition for project visibility based on user context and map mode
export function buildProjectVisibilityCondition(
  user: UserContext,
  mode: MapMode
): SQL {
  if (mode === 'view') {
    // AI : View mode: only show approved projects
    return eq(projects.status, 'approved');
  }

  if (mode === 'edit' && user) {
    // AI : Edit mode: show approved projects OR user's own projects (any status)
    return sql`(${projects.status} = 'approved' OR ${projects.ownerId} = ${user.id})`;
  }

  if (mode === 'moderation' && user) {
    // AI : Moderation mode: show approved projects OR projects with pending overlays
    return sql`(${projects.status} = 'approved' OR ${projects.status} = 'pending')`;
  }

  // AI : Default (anonymous or unrecognized mode): only show approved projects
  return eq(projects.status, 'approved');
}

// AI : Build WHERE condition for overlay visibility based on user context and map mode
// AI : Can also handle admin includeStatus filter (takes precedence over mode logic)
export function buildOverlayVisibilityCondition(
  user: UserContext,
  mode: MapMode,
  overlayChangeRequestIds?: string[],
  adminIncludeStatus?: ApprovalStatus[]
): SQL {
  // AI : Admin status filter takes precedence
  if (adminIncludeStatus && user?.role === 'admin' && adminIncludeStatus.length > 0) {
    return inArray(overlays.status, adminIncludeStatus);
  }

  if (mode === 'view') {
    // AI : View mode: only show approved overlays
    return eq(overlays.status, 'approved');
  }

  if (mode === 'edit' && user) {
    // AI : Edit mode: show approved overlays OR user's own overlays OR overlays with user's change requests
    if (overlayChangeRequestIds && overlayChangeRequestIds.length > 0) {
      const idsArray = `{${overlayChangeRequestIds.join(',')}}`;
      return sql`(
        ${overlays.status} = 'approved'
        OR ${overlays.authorId} = ${user.id}
        OR ${overlays.id} = ANY(${idsArray}::uuid[])
      )`;
    } else {
      return sql`(${overlays.status} = 'approved' OR ${overlays.authorId} = ${user.id})`;
    }
  }

  if (mode === 'moderation' && user) {
    // AI : Moderation mode: show ALL overlays (approved + pending) for review
    return sql`(${overlays.status} = 'approved' OR ${overlays.status} = 'pending')`;
  }

  // AI : Default (anonymous or unrecognized mode): only show approved overlays
  return eq(overlays.status, 'approved');
}

// AI : Build WHERE condition for project status (handles admin includeStatus filter)
export function buildProjectStatusCondition(
  user: UserContext,
  adminIncludeStatus?: ApprovalStatus[]
): SQL {
  if (adminIncludeStatus && user?.role === 'admin' && adminIncludeStatus.length > 0) {
    return inArray(projects.status, adminIncludeStatus);
  }
  return eq(projects.status, 'approved');
}

// AI : Build condition to filter projects that have visible content (development projects OR projects with visible overlays)
// AI : This ensures we don't show empty non-development projects in view mode
// AI : In edit mode, also show user's own projects even if they don't have overlays yet
export function buildProjectHasVisibleContentCondition(
  user: UserContext,
  mode: MapMode,
  overlayChangeRequestIds?: string[]
): SQL {
  if (mode === 'view') {
    // AI : View mode: show if development OR has approved overlays
    return sql`(
      ${projects.isDevelopment} = true
      OR EXISTS (
        SELECT 1 FROM ${overlays}
        WHERE ${overlays.projectId} = ${projects.id}
        AND ${overlays.status} = 'approved'
      )
    )`;
  }

  if (mode === 'edit' && user) {
    // AI : Edit mode: show if development OR has visible overlays OR is owned by user (even without overlays)
    if (overlayChangeRequestIds && overlayChangeRequestIds.length > 0) {
      const idsArray = `{${overlayChangeRequestIds.join(',')}}`;
      return sql`(
        ${projects.isDevelopment} = true
        OR ${projects.ownerId} = ${user.id}
        OR EXISTS (
          SELECT 1 FROM ${overlays}
          WHERE ${overlays.projectId} = ${projects.id}
          AND (
            ${overlays.status} = 'approved'
            OR ${overlays.authorId} = ${user.id}
            OR ${overlays.id} = ANY(${idsArray}::uuid[])
          )
        )
      )`;
    } else {
      return sql`(
        ${projects.isDevelopment} = true
        OR ${projects.ownerId} = ${user.id}
        OR EXISTS (
          SELECT 1 FROM ${overlays}
          WHERE ${overlays.projectId} = ${projects.id}
          AND (${overlays.status} = 'approved' OR ${overlays.authorId} = ${user.id})
        )
      )`;
    }
  }

  if (mode === 'moderation' && user) {
    // AI : Moderation mode: show if development OR has any overlays (approved or pending)
    return sql`(
      ${projects.isDevelopment} = true
      OR EXISTS (
        SELECT 1 FROM ${overlays}
        WHERE ${overlays.projectId} = ${projects.id}
        AND (${overlays.status} = 'approved' OR ${overlays.status} = 'pending')
      )
    )`;
  }

  // AI : Default: same as view mode
  return sql`(
    ${projects.isDevelopment} = true
    OR EXISTS (
      SELECT 1 FROM ${overlays}
      WHERE ${overlays.projectId} = ${projects.id}
      AND ${overlays.status} = 'approved'
    )
  )`;
}
