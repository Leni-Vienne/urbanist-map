import { sql, eq, and, inArray, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db } from '../database';
import { projects, cities, overlays, countries, changeRequests, users, type ApprovalStatus } from './schema';
import type * as schema from './schema';
import type { MapMode } from '@shared/types';

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
  replacedByOverlayId: overlays.replacedByOverlayId,
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
      authorId: overlays.authorId, // AI : For spam prevention filtering
      authorUsername: users.username, // AI : Display friendly username in moderation UI
      authorApprovedCount: users.approvedCount, // AI : User stats for spam detection
      authorRejectedCount: users.rejectedCount,
      replacesOverlayId: overlays.replacesOverlayId,
      replacedByOverlayId: overlays.replacedByOverlayId,
      updatedAt: overlays.updatedAt,
      cityId: cities.id,
      cityName: cities.name,
      countryCode: countries.code,
      countryName: countries.name,
    })
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .innerJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code))
    .leftJoin(users, eq(overlays.authorId, users.id));
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
      proposalDate: projects.proposalDate,
      sourceUrl: projects.sourceUrl,
      lat: projects.lat,
      lng: projects.lng,
      cityId: projects.cityId,
      ownerId: projects.ownerId, // AI : For spam prevention filtering
      ownerUsername: users.username, // AI : Display friendly username in moderation UI
      ownerApprovedCount: users.approvedCount, // AI : User stats for spam detection
      ownerRejectedCount: users.rejectedCount,
      cityName: cities.name,
      countryCode: countries.code,
      countryName: countries.name,
    })
    .from(projects)
    .innerJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code))
    .leftJoin(users, eq(projects.ownerId, users.id));
}

// AI : ============================================================================
// AI : CHANGE REQUEST HELPERS
// AI : ============================================================================

/**
 * AI : Interface for objects that can have conflict detection applied
 */
interface ConflictableChange {
  entityType: string;
  entityId: string;
  fieldName: string;
}

/**
 * AI : Adds hasConflict flag to change requests that have multiple pending requests for the same field
 * AI : A conflict occurs when 2+ pending changes target the same entity+field combination
 *
 * @param changes - Array of change requests with entityType, entityId, and fieldName
 * @returns Same array with hasConflict boolean added to each item
 */
export function addConflictFlags<T extends ConflictableChange>(
  changes: T[]
): (T & { hasConflict: boolean })[] {
  const conflictMap = new Map<string, number>();

  for (const change of changes) {
    const key = `${change.entityType}:${change.entityId}:${change.fieldName}`;
    conflictMap.set(key, (conflictMap.get(key) ?? 0) + 1);
  }

  return changes.map(change => {
    const key = `${change.entityType}:${change.entityId}:${change.fieldName}`;
    return { ...change, hasConflict: (conflictMap.get(key) ?? 0) > 1 };
  });
}

/**
 * AI : Base interface for change requests that can be enriched with city names
 */
interface BaseChangeRequest {
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * AI : Default empty enrichment object for non-cityId fields
 */
const EMPTY_CITY_ENRICHMENT = {
  oldCityName: null,
  newCityName: null,
  oldCountryCode: null,
  newCountryCode: null,
  oldCountryName: null,
  newCountryName: null,
} as const;

/**
 * AI : Type for enriched change requests with city/country metadata
 */
type EnrichedChangeRequest<T extends BaseChangeRequest> = T & {
  oldCityName: string | null;
  newCityName: string | null;
  oldCountryCode: string | null;
  newCountryCode: string | null;
  oldCountryName: string | null;
  newCountryName: string | null;
};

/**
 * AI : Convert JSONB value to string and validate it's a valid city ID
 * AI : Returns null for invalid values (null, undefined, or their string representations)
 */
function toValidCityId(value: unknown): string | null {
  if (!value) return null;

  const stringValue = typeof value === 'string' ? value : String(value);

  if (stringValue === 'null' || stringValue === 'undefined') return null;

  return stringValue;
}

/**
 * AI : Extract all unique city IDs from cityId field changes
 */
function extractCityIds(changes: BaseChangeRequest[]): Set<string> {
  const cityIds = new Set<string>();

  for (const change of changes) {
    if (change.fieldName === 'cityId') {
      const oldCityId = toValidCityId(change.oldValue);
      const newCityId = toValidCityId(change.newValue);

      if (oldCityId) cityIds.add(oldCityId);
      if (newCityId) cityIds.add(newCityId);
    }
  }

  return cityIds;
}

/**
 * AI : Enrich change requests with city and country names for cityId field changes
 * AI : This helper queries the database to fetch city/country names and adds them to the change objects
 * AI : Used by both changes router and moderation router
 *
 * @param changes - Array of change requests with fieldName, oldValue, newValue
 * @returns Same array enriched with city/country name fields
 */
export async function enrichChangeRequestsWithNames<T extends BaseChangeRequest>(
  changes: T[]
): Promise<EnrichedChangeRequest<T>[]> {
  // AI : Extract all unique cityIds from change requests where fieldName is 'cityId'
  const cityIds = extractCityIds(changes);

  // AI : If no city changes, return with empty enrichment
  if (cityIds.size === 0) {
    return changes.map(change => ({
      ...change,
      ...EMPTY_CITY_ENRICHMENT,
    }));
  }

  // AI : Fetch all cities with their country names in one query using a join
  const cityData = await db
    .select({
      id: cities.id,
      name: cities.name,
      countryCode: cities.countryCode,
      countryName: countries.name,
    })
    .from(cities)
    .leftJoin(countries, eq(cities.countryCode, countries.code))
    .where(inArray(cities.id, [...cityIds]));

  // AI : Create a map for quick lookup
  const cityMap = new Map(cityData.map(c => [c.id, c]));

  // AI : Enrich change requests with city and country names
  return changes.map(change => {
    if (change.fieldName !== 'cityId') {
      return {
        ...change,
        ...EMPTY_CITY_ENRICHMENT,
      };
    }

    const oldCityId = toValidCityId(change.oldValue);
    const newCityId = toValidCityId(change.newValue);

    const oldCity = oldCityId ? cityMap.get(oldCityId) : null;
    const newCity = newCityId ? cityMap.get(newCityId) : null;

    return {
      ...change,
      oldCityName: oldCity?.name ?? null,
      newCityName: newCity?.name ?? null,
      oldCountryCode: oldCity?.countryCode ?? null,
      newCountryCode: newCity?.countryCode ?? null,
      oldCountryName: oldCity?.countryName ?? null,
      newCountryName: newCity?.countryName ?? null,
    };
  });
}

// AI : ============================================================================
// AI : VISIBILITY HELPERS
// AI : ============================================================================

// AI : Type for user context from tRPC (can be undefined or null)
export type UserContext = {
  id: string;
  role?: string | null;
} | undefined | null;


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
    // AI : Edit mode: show approved overlays OR user's own PENDING overlays OR overlays with user's change requests
    // AI : Rejected and replaced overlays are NOT shown even if user owns them
    if (overlayChangeRequestIds && overlayChangeRequestIds.length > 0) {
      const idsArray = `{${overlayChangeRequestIds.join(',')}}`;
      return sql`(
        ${overlays.status} = 'approved'
        OR (${overlays.authorId} = ${user.id} AND ${overlays.status} = 'pending')
        OR ${overlays.id} = ANY(${idsArray}::uuid[])
      )`;
    } else {
      return sql`(${overlays.status} = 'approved' OR (${overlays.authorId} = ${user.id} AND ${overlays.status} = 'pending'))`;
    }
  }

  if (mode === 'moderation' && user) {
    // AI : Moderation mode: show ALL overlays (approved + pending) for review
    return sql`(${overlays.status} = 'approved' OR ${overlays.status} = 'pending')`;
  }

  // AI : Default (anonymous or unrecognized mode): only show approved overlays
  return eq(overlays.status, 'approved');
}

// AI : Build condition to filter projects that have visible content (projects without images OR projects with visible overlays)
// AI : This ensures all projects are shown whether they have images or not
// AI : In edit mode, also show user's own projects even if they don't have overlays yet
export function buildProjectHasVisibleContentCondition(
  user: UserContext,
  mode: MapMode,
  overlayChangeRequestIds?: string[]
): SQL {
  if (mode === 'view') {
    // AI : View mode: show if no approved overlays OR has approved overlays (all approved projects visible as either basic markers or with overlays)
    return sql`(
      NOT EXISTS (
        SELECT 1 FROM ${overlays}
        WHERE ${overlays.projectId} = ${projects.id}
        AND ${overlays.status} = 'approved'
      )
      OR EXISTS (
        SELECT 1 FROM ${overlays}
        WHERE ${overlays.projectId} = ${projects.id}
        AND ${overlays.status} = 'approved'
      )
    )`;
  }

  if (mode === 'edit' && user) {
    // AI : Edit mode: show if no approved overlays OR has approved/user overlays OR is owned by user
    // AI : Use same logic as view mode but also include user's pending overlays
    if (overlayChangeRequestIds && overlayChangeRequestIds.length > 0) {
      const idsArray = `{${overlayChangeRequestIds.join(',')}}`;
      return sql`(
        NOT EXISTS (
          SELECT 1 FROM ${overlays}
          WHERE ${overlays.projectId} = ${projects.id}
          AND ${overlays.status} = 'approved'
        )
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
        NOT EXISTS (
          SELECT 1 FROM ${overlays}
          WHERE ${overlays.projectId} = ${projects.id}
          AND ${overlays.status} = 'approved'
        )
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
    // AI : Moderation mode: show if no overlays OR has any overlays (approved or pending)
    return sql`(
      NOT EXISTS (
        SELECT 1 FROM ${overlays}
        WHERE ${overlays.projectId} = ${projects.id}
      )
      OR EXISTS (
        SELECT 1 FROM ${overlays}
        WHERE ${overlays.projectId} = ${projects.id}
        AND (${overlays.status} = 'approved' OR ${overlays.status} = 'pending')
      )
    )`;
  }

  // AI : Default: same as view mode (check for approved overlays, not any overlays)
  return sql`(
    NOT EXISTS (
      SELECT 1 FROM ${overlays}
      WHERE ${overlays.projectId} = ${projects.id}
      AND ${overlays.status} = 'approved'
    )
    OR EXISTS (
      SELECT 1 FROM ${overlays}
      WHERE ${overlays.projectId} = ${projects.id}
      AND ${overlays.status} = 'approved'
    )
  )`;
}
