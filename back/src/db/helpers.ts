import { sql, eq, and, inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { db } from "../database";
import {
  projects,
  cities,
  overlays,
  countries,
  changeRequests,
  users,
  userReports,
  type ApprovalStatus,
} from "./schema";
import type * as schema from "./schema";
import type { AppMode } from "@shared/types";

// ============================================================================
// DATABASE HELPERS - Unified utilities for pagination, queries, and visibility
// ============================================================================
// Combines pagination, query builders, and visibility helpers to eliminate
// duplication and provide single source of truth for database operations
// ============================================================================

// ============================================================================
// PAGINATION HELPERS
// ============================================================================

/**
 * Standard pagination input filters used across multiple endpoints
 */
interface PaginationFilters {
  cityId?: number;
  countryCode?: string;
  cursor?: string;
}

/**
 * Build common filter conditions for pagination queries
 * Adds cityId, countryCode, and cursor-based pagination conditions
 *
 * @param filters - Object containing optional cityId, countryCode, and cursor
 * @param sortColumn - The column used for sorting (determines cursor comparison)
 * @returns Array of SQL conditions to be used in where clauses
 */
export async function buildPaginationConditions(
  filters: PaginationFilters,
  sortColumn: PgColumn,
): Promise<SQL[]> {
  const conditions: SQL[] = [];

  if (filters.cityId) {
    conditions.push(eq(projects.cityId, filters.cityId));
  }

  if (filters.countryCode) {
    conditions.push(eq(cities.countryCode, filters.countryCode));
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
      conditions.push(sql`${sortColumn} < ${cursorValue.sortValue}`);
    }
  }

  return conditions;
}

/**
 * Build pagination response with nextCursor and hasMore flag
 *
 * @param results - Array of query results
 * @param limit - The requested limit
 * @returns Object with paginated items and pagination metadata
 */
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

// ============================================================================
// QUERY BUILDERS
// ============================================================================

/**
 * Select fields for overlay queries with full location hierarchy
 * Extracts PostGIS geometry as JSON for corners and centroid
 */
const overlaySelectFields = {
  id: overlays.id,
  version: overlays.version,
  filename: overlays.filename,
  caption: overlays.caption,
  status: overlays.status,
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
  // Extract centroid as {lat, lng}
  centroid: sql<{ lat: number; lng: number }>`
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
 * Build overlay query with full location joins (overlay -> project -> city -> country)
 * Returns chainable query that can be extended with .where(), .orderBy(), .limit()
 */
export function buildOverlayQuery(database: BunSQLDatabase<typeof schema>) {
  return database
    .select(overlaySelectFields)
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .innerJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}

// Shared project column selection — add new project fields here only
const PROJECT_COLUMNS = {
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
  proposalDatePrecision: projects.proposalDatePrecision,
  startDate: projects.startDate,
  startDatePrecision: projects.startDatePrecision,
  endDate: projects.endDate,
  endDatePrecision: projects.endDatePrecision,
  sourceUrl: projects.sourceUrl,
  tags: projects.tags,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
  geometry: projects.geometry,
  rejectionReason: projects.rejectionReason,
  centerCoordinate: projects.centerCoordinate,
} as const;

/**
 * Build project query with city and country location data
 * Returns chainable query that can be extended with .where(), .orderBy(), .limit()
 */
export function buildProjectWithLocationQuery(database: BunSQLDatabase<typeof schema>) {
  return database
    .select({
      ...PROJECT_COLUMNS,
      cityName: cities.name,
      countryCode: countries.code,
      countryName: countries.name,
      city: cities,
    })
    .from(projects)
    .innerJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}

/**
 * Build overlay query with minimal fields for moderation lists
 * Includes location data but not full geometry extraction
 */
export function buildOverlayModerationQuery(database: BunSQLDatabase<typeof schema>) {
  return database
    .select({
      id: overlays.id,
      name: sql<string>`coalesce(${overlays.caption}, 'Unnamed')`,
      filename: overlays.filename,
      status: overlays.status,
      version: overlays.version,
      projectId: overlays.projectId,
      authorId: overlays.authorId, // For spam prevention filtering
      authorUsername: users.username, // Display friendly username in moderation UI
      authorApprovedCount: users.approvedCount, // User stats for spam detection
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
 * Build project query with minimal fields for moderation lists
 */
export function buildProjectModerationQuery(database: BunSQLDatabase<typeof schema>) {
  return database
    .select({
      ...PROJECT_COLUMNS,
      ownerUsername: users.username, // Display friendly username in moderation UI
      ownerApprovedCount: users.approvedCount, // User stats for spam detection
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

// ============================================================================
// CHANGE REQUEST HELPERS
// ============================================================================

/**
 * Interface for objects that can have conflict detection applied
 */
interface ConflictableChange {
  entityType: string;
  entityId: string;
  fieldName: string;
}

/**
 * Adds hasConflict flag to change requests that have multiple pending requests for the same field
 * A conflict occurs when 2+ pending changes target the same entity+field combination
 *
 * @param changes - Array of change requests with entityType, entityId, and fieldName
 * @returns Same array with hasConflict boolean added to each item
 */
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

/**
 * Base interface for change requests that can be enriched with city names
 */
interface BaseChangeRequest {
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * Default empty enrichment object for non-cityId fields
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
 * Type for enriched change requests with city/country metadata
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
 * Convert JSONB value to string and validate it's a valid city ID
 * Returns null for invalid values (null, undefined, or their string representations)
 */
function toValidCityId(value: unknown): number | null {
  if (!value) return null;

  const stringValue = typeof value === "string" ? value : String(value);

  if (stringValue === "null" || stringValue === "undefined") return null;

  return Number(stringValue);
}

/**
 * Extract all unique city IDs from cityId field changes
 */
function extractCityIds(changes: BaseChangeRequest[]): Set<number> {
  const cityIds = new Set<number>();

  for (const change of changes) {
    if (change.fieldName === "cityId") {
      const oldCityId = toValidCityId(change.oldValue);
      const newCityId = toValidCityId(change.newValue);

      if (oldCityId) cityIds.add(oldCityId);
      if (newCityId) cityIds.add(newCityId);
    }
  }

  return cityIds;
}

/**
 * Enrich change requests with city and country names for cityId field changes
 * This helper queries the database to fetch city/country names and adds them to the change objects
 * Used by both changes router and moderation router
 *
 * @param changes - Array of change requests with fieldName, oldValue, newValue
 * @returns Same array enriched with city/country name fields
 */
export async function enrichChangeRequestsWithNames<T extends BaseChangeRequest>(
  changes: T[],
): Promise<EnrichedChangeRequest<T>[]> {
  // Extract all unique cityIds from change requests where fieldName is 'cityId'
  const cityIds = extractCityIds(changes);

  // If no city changes, return with empty enrichment
  if (cityIds.size === 0) {
    return changes.map((change) => ({
      ...change,
      ...EMPTY_CITY_ENRICHMENT,
    }));
  }

  // Fetch all cities with their country names in one query using a join
  const cityData = await db
    .select({
      id: cities.id,
      name: cities.name,
      nameLocal: cities.nameLocal,
      countryCode: cities.countryCode,
      countryName: countries.name,
    })
    .from(cities)
    .leftJoin(countries, eq(cities.countryCode, countries.code))
    .where(inArray(cities.id, [...cityIds]));

  // Create a map for quick lookup
  const cityMap = new Map(cityData.map((c) => [c.id, c]));

  // Enrich change requests with city and country names
  return changes.map((change) => {
    if (change.fieldName !== "cityId") {
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

// ============================================================================
// VISIBILITY HELPERS
// ============================================================================

// Type for user context from tRPC (can be undefined or null)
type UserContext =
  | {
      id: string;
      role?: string | null;
    }
  | undefined
  | null;

// Fetch overlay IDs where user has pending change requests
export async function getUserOverlayChangeRequestIds(
  database: BunSQLDatabase<typeof schema>,
  userId: string,
): Promise<string[]> {
  const changeRequestResults = await database
    .selectDistinct({ overlayId: changeRequests.entityId })
    .from(changeRequests)
    .where(and(eq(changeRequests.requestedBy, userId), eq(changeRequests.entityType, "overlay")));

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
    return sql`(
      ${projects.status} = 'pending'
      OR EXISTS (
        SELECT 1 FROM ${overlays}
        WHERE ${overlays.projectId} = ${projects.id}
        AND ${overlays.status} = 'pending'
      )
      OR EXISTS (
        SELECT 1 FROM ${changeRequests}
        WHERE ${changeRequests.entityType} = 'project'
        AND ${changeRequests.entityId} = ${projects.id}
        AND ${changeRequests.status} = 'pending'
      )
      OR EXISTS (
        SELECT 1 FROM ${changeRequests}
        INNER JOIN ${overlays} ON ${changeRequests.entityId} = ${overlays.id}
        WHERE ${changeRequests.entityType} = 'overlay'
        AND ${overlays.projectId} = ${projects.id}
        AND ${changeRequests.status} = 'pending'
      )
    )`;
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

// Build condition to filter projects that have visible content (projects without images OR projects with visible overlays)
// This ensures all projects are shown whether they have images or not
// In edit mode, also show user's own projects even if they don't have overlays yet
export function buildProjectHasVisibleContentCondition(
  user: UserContext,
  mode: AppMode,
  overlayChangeRequestIds?: string[],
): SQL {
  if (mode === "view") {
    // View mode: show if no approved overlays OR has approved overlays (all approved projects visible as either basic markers or with overlays)
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

  if (mode === "edit" && user) {
    // Edit mode: show if no approved overlays OR has approved/user overlays OR is owned by user
    // Use same logic as view mode but also include user's pending overlays
    if (overlayChangeRequestIds && overlayChangeRequestIds.length > 0) {
      const idsArray = `{${overlayChangeRequestIds.join(",")}}`;
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

  if (mode === "moderation" && user) {
    // Moderation mode: only show projects that need moderation
    // This includes: pending projects OR projects with pending overlays OR projects with pending change requests
    // Excludes: approved projects with only approved content and no pending changes
    return sql`(
      ${projects.status} = 'pending'
      OR EXISTS (
        SELECT 1 FROM ${overlays}
        WHERE ${overlays.projectId} = ${projects.id}
        AND ${overlays.status} = 'pending'
      )
      OR EXISTS (
        SELECT 1 FROM ${changeRequests}
        WHERE ${changeRequests.entityType} = 'project'
        AND ${changeRequests.entityId} = ${projects.id}
        AND ${changeRequests.status} = 'pending'
      )
      OR EXISTS (
        SELECT 1 FROM ${changeRequests}
        INNER JOIN ${overlays} ON ${changeRequests.entityId} = ${overlays.id}
        WHERE ${changeRequests.entityType} = 'overlay'
        AND ${overlays.projectId} = ${projects.id}
        AND ${changeRequests.status} = 'pending'
      )
    )`;
  }

  // Default: same as view mode (check for approved overlays, not any overlays)
  return sql`(
    NOT EXISTS (
      SELECT 1 FROM ${overlays}
      WHERE ${overlays.projectId} = ${projects.id}
      AND ${overlays.status} = 'approved'
    )
      SELECT 1 FROM ${overlays}
      WHERE ${overlays.projectId} = ${projects.id}
      AND ${overlays.status} = 'approved'
    )
  )`;
}

// ============================================================================
// SPAM PREVENTION HELPERS
// ============================================================================

/**
 * Check if a user is blocked from contributing content
 * A user is blocked if they are banned OR have reached the report threshold (2+ moderator reports)
 *
 * @param userId - The user ID to check
 * @returns Promise<boolean> - True if the user is blocked from contributing
 */
export async function isUserBlocked(userId: string): Promise<boolean> {
  try {
    // Fetch user banned status
    const userResult = await db
      .select({ banned: users.banned })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // If user not found or banned, block them
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
