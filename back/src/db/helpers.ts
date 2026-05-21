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
  importSources,
  type ApprovalStatus,
} from "./schema";
import type * as schema from "./schema";
import type { AppMode } from "@shared/types";

interface PaginationFilters {
  cityId?: number;
  countryCode?: string;
  cursor?: string;
}

export async function buildPaginationConditions(
  filters: PaginationFilters,
  sortColumn: PgColumn,
): Promise<SQL[]> {
  const conditions: SQL[] = [];

  if (filters.cityId) {
    conditions.push(eq(projects.cityId, filters.cityId));
  }

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
      conditions.push(sql`${sortColumn} < ${cursorValue.sortValue}`);
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
  countryCode: projects.countryCode,
  countryName: countries.name,
};

export function buildOverlayQuery(database: BunSQLDatabase<typeof schema>) {
  return database
    .select(overlaySelectFields)
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .leftJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(projects.countryCode, countries.code));
}

// Shared project column selection, add new project fields here only
export const PROJECT_COLUMNS = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  status: projects.status,
  version: projects.version,
  ownerId: projects.ownerId,
  cityId: projects.cityId,
  timelineStatus: projects.timelineStatus,
  importSourceId: projects.importSourceId,
  externalId: projects.externalId,
  externalProperties: projects.externalProperties,
  externalLastModified: projects.externalLastModified,
  lastImportedAt: projects.lastImportedAt,
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
  rejectionReason: projects.rejectionReason,
  centerCoordinate: projects.centerCoordinate,
  countryCode: projects.countryCode,
  detachedAt: projects.detachedAt,
} as const;

export function buildProjectWithLocationQuery(database: BunSQLDatabase<typeof schema>) {
  return database
    .select({
      ...PROJECT_COLUMNS,
      cityName: cities.name,
      countryName: countries.name,
      city: cities,
    })
    .from(projects)
    .leftJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(projects.countryCode, countries.code));
}

/**
 * Build overlay query with minimal fields for moderation lists
 * Includes location data but not full geometry extraction
 */
export function buildOverlayModerationQuery(database: BunSQLDatabase<typeof schema>) {
  return database
    .select({
      id: overlays.id,
      caption: overlays.caption,
      filename: overlays.filename,
      status: overlays.status,
      version: overlays.version,
      projectId: overlays.projectId,
      authorId: overlays.authorId,
      authorUsername: users.username,
      authorApprovedCount: users.approvedCount,
      authorRejectedCount: users.rejectedCount,
      replacesOverlayId: overlays.replacesOverlayId,
      replacedByOverlayId: overlays.replacedByOverlayId,
      updatedAt: overlays.updatedAt,
      cityId: cities.id,
      cityName: cities.name,
      countryCode: projects.countryCode,
      countryName: countries.name,
    })
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .leftJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(projects.countryCode, countries.code))
    .leftJoin(users, eq(overlays.authorId, users.id));
}

export function buildProjectModerationQuery(database: BunSQLDatabase<typeof schema>) {
  const { geometry: _geometry, ...columnsWithoutGeometry } = PROJECT_COLUMNS;
  return database
    .select({
      ...columnsWithoutGeometry,
      ownerUsername: users.username,
      ownerApprovedCount: users.approvedCount,
      ownerRejectedCount: users.rejectedCount,
      cityName: cities.name,
      countryName: countries.name,
    })
    .from(projects)
    .leftJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(projects.countryCode, countries.code))
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

interface BaseChangeRequest {
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
}

const EMPTY_CITY_ENRICHMENT = {
  oldCityName: null,
  newCityName: null,
  oldCountryCode: null,
  newCountryCode: null,
  oldCountryName: null,
  newCountryName: null,
} as const;

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

  if (typeof value === "number") return value;

  if (typeof value === "string") {
    if (value === "null" || value === "undefined") return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

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

// Queries DB to resolve cityId changes into city/country names. Used by changes and moderation routers.
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

// Type for user context from tRPC (can be undefined or null)
type UserContext =
  | {
      id: string;
      role?: string | null;
      moderatedCountries?: string[] | null;
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

export async function fetchOverlayChangeRequests(
  user: UserContext,
  mode: AppMode,
): Promise<
  Map<
    string,
    {
      id: string;
      entityType: string;
      entityId: string;
      fieldName: string;
      newValue: unknown;
      requestedBy: string | null;
    }[]
  >
> {
  let changeRequestsData: {
    id: string;
    entityType: string;
    entityId: string;
    fieldName: string;
    newValue: unknown;
    requestedBy: string | null;
  }[] = [];

  if (user) {
    if (mode === "edit") {
      changeRequestsData = await db
        .select({
          id: changeRequests.id,
          entityType: changeRequests.entityType,
          entityId: changeRequests.entityId,
          fieldName: changeRequests.fieldName,
          newValue: changeRequests.newValue,
          requestedBy: changeRequests.requestedBy,
        })
        .from(changeRequests)
        .where(
          and(
            eq(changeRequests.requestedBy, user.id),
            eq(changeRequests.entityType, "overlay"),
            eq(changeRequests.status, "pending"),
          ),
        );
    } else if (mode === "moderation") {
      changeRequestsData = await db
        .select({
          id: changeRequests.id,
          entityType: changeRequests.entityType,
          entityId: changeRequests.entityId,
          fieldName: changeRequests.fieldName,
          newValue: changeRequests.newValue,
          requestedBy: changeRequests.requestedBy,
        })
        .from(changeRequests)
        .where(and(eq(changeRequests.entityType, "overlay"), eq(changeRequests.status, "pending")));
    }
  }

  // Group change requests by overlay ID for easy lookup
  const changeRequestsByOverlay = new Map<string, typeof changeRequestsData>();
  for (const cr of changeRequestsData) {
    const existing = changeRequestsByOverlay.get(cr.entityId) ?? [];
    existing.push(cr);
    changeRequestsByOverlay.set(cr.entityId, existing);
  }

  return changeRequestsByOverlay;
}

export function transformOverlayDataWithChangeRequests(
  overlaysData: Awaited<ReturnType<typeof fetchOverlaysWithLocation>>,
  changeRequestsByOverlay: Map<
    string,
    {
      fieldName: string;
      newValue: unknown;
      requestedBy: string | null;
    }[]
  >,
  allChangeRequestCounts: Map<string, number>,
  mode: AppMode,
  userId?: string,
) {
  return overlaysData.map((row) => {
    const approvedCorners = row.corners;
    const centroid = { lat: row.centroidLat, lng: row.centroidLng };

    const overlayChangeRequests = changeRequestsByOverlay.get(row.overlayId) ?? [];

    const cornersChangeRequest = overlayChangeRequests.find((cr) => cr.fieldName === "corners");
    const hasPendingCorners = Boolean(cornersChangeRequest);
    const suggestedCorners =
      hasPendingCorners && cornersChangeRequest?.newValue
        ? (cornersChangeRequest.newValue as { lat: number; lng: number }[])
        : null;

    const userHasPendingChanges =
      mode === "edit" && overlayChangeRequests.some((cr) => cr.requestedBy === userId);

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
      distance: 0,
      project: {
        ...row.project,
        city: row.city,
        importSource: row.importSource,
      },
      hasPendingChanges: mode === "moderation" ? hasPendingCorners : userHasPendingChanges,
      pendingChangeRequestsCount:
        mode === "moderation" ? (allChangeRequestCounts.get(row.overlayId) ?? 0) : undefined,
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
        ...projects,
        geometry: sql<GeoJSON.GeometryCollection | null>`CASE WHEN ${projects.geometry} IS NULL THEN NULL ELSE ST_AsGeoJSON(${projects.geometry})::json END`,
      },
      city: cities,
      importSource: importSources,
    })
    .from(overlays)
    .innerJoin(projects, eq(projects.id, overlays.projectId))
    .leftJoin(cities, eq(cities.id, projects.cityId))
    .leftJoin(importSources, eq(importSources.id, projects.importSourceId))
    .where(and(...whereConditions))
    .orderBy(overlays.createdAt);
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
