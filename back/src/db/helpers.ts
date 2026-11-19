import { sql, eq, and, inArray, type SQL } from "drizzle-orm";
import { db, type Database, type DatabaseExecutor } from "../database";
import { projects, overlays, changeRequests, users, userReports, importSources } from "./schema";
import type { BoundaryPathEntry } from "@shared/types/boundary";
import { buildOwnOverlayProposal } from "./overlayProposal";
import { overlayCornersJsonSql } from "./geometry";

// Country display name resolved from the level-2 (country) admin boundary matching a project's
// country_code. Replaces the former join to the dropped `countries` table.
// The outer column is written qualified: a drizzle column reference is emitted bare in a
// join-free query, and a bare `country_code` inside the subquery binds to `ab`, matching every row.
export const countryNameSql = sql<
  string | null
>`(SELECT ab.name FROM admin_boundaries ab WHERE ab.admin_level = 2 AND ab.country_code = "projects"."country_code" LIMIT 1)`;

// Locales whose OSM `name:<code>` variant always reaches the client. English travels separately as
// nameEn, and each boundary's native/local label travels as name.
const BOUNDARY_NAME_LOCALES = ["fr"];

// The depth limit bounds malformed parent chains, including cycles.
export function boundaryPathSql(requestLanguage = "en"): SQL<BoundaryPathEntry[]> {
  const nameLocales =
    requestLanguage === "en"
      ? BOUNDARY_NAME_LOCALES
      : [...new Set([...BOUNDARY_NAME_LOCALES, requestLanguage])];
  return sql`COALESCE((
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
    json_build_object('name', name, 'nameEn', name_en, 'names', (
      SELECT json_object_agg(n.k, n.v)
      FROM jsonb_each_text(COALESCE(names, '{}'::jsonb)) AS n(k, v)
      WHERE n.k = ANY(${textArray(nameLocales)})
    ), 'adminLevel', admin_level)
    ORDER BY admin_level DESC
  )
  FROM chain
), '[]'::json)`;
}

// Binds one param per element, so the value reaches Postgres as an array rather than as a
// comma-separated parameter list.
export function textArray(values: string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

// Overlay fields shared by API reads, with PostGIS geometry decoded into coordinates.
export const OVERLAY_COLUMNS = {
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
  corners: overlayCornersJsonSql(overlays.corners),
  centroid: sql<{ lat: number; lng: number }>`
    json_build_object('lat', ST_Y(${overlays.centroid}), 'lng', ST_X(${overlays.centroid}))
  `,
  createdAt: overlays.createdAt,
  updatedAt: overlays.updatedAt,
};

export function buildOverlayQuery(database: Database) {
  return database
    .select({
      ...OVERLAY_COLUMNS,
      kind: overlays.kind,
      projectName: projects.name,
      countryCode: projects.countryCode,
      countryName: countryNameSql,
    })
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id));
}

// Public source metadata, excluding importer scheduling and synchronization state.
export const IMPORT_SOURCE_COLUMNS = {
  id: importSources.id,
  name: importSources.name,
  type: importSources.type,
  urlTemplate: importSources.urlTemplate,
} as const;

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

export function buildProjectWithLocationQuery(database: Database, requestLanguage: string) {
  return database
    .select({
      ...PROJECT_COLUMNS,
      rejectionReason: projects.rejectionReason,
      countryName: countryNameSql,
      boundaryPath: boundaryPathSql(requestLanguage),
      importSource: IMPORT_SOURCE_COLUMNS,
    })
    .from(projects)
    .leftJoin(importSources, eq(importSources.id, projects.importSourceId));
}

/**
 * Build overlay query with minimal fields for moderation lists
 * Includes location data but not full geometry extraction
 */
export function buildOverlayModerationQuery(database: DatabaseExecutor) {
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
      rejectionReason: overlays.rejectionReason,
      updatedAt: overlays.updatedAt,
      countryCode: projects.countryCode,
      countryName: countryNameSql,
    })
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .leftJoin(users, eq(overlays.authorId, users.id));
}

export function buildProjectModerationQuery(database: Database) {
  return database
    .select({
      ...PROJECT_COLUMNS,
      importSource: IMPORT_SOURCE_COLUMNS,
      hasImage: sql<boolean>`EXISTS (
        SELECT 1
        FROM overlays AS project_image
        WHERE project_image.project_id = ${projects.id}
          AND project_image.status IN ('approved', 'pending')
      )`,
      ownerUsername: users.username,
      ownerApprovedCount: users.approvedCount,
      ownerRejectedCount: users.rejectedCount,
      countryName: countryNameSql,
    })
    .from(projects)
    .leftJoin(importSources, eq(importSources.id, projects.importSourceId))
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

export function buildOverlayVisibilityCondition(user: UserContext): SQL {
  if (!user) return eq(overlays.status, "approved");
  return sql`(${overlays.status} = 'approved' OR (${overlays.authorId} = ${user.id} AND ${overlays.status} = 'pending'))`;
}

type OverlayChangeValue = { fieldName: string; newValue: unknown };
type OverlayLocationRow = Awaited<ReturnType<typeof fetchOverlayLocationRows>>[number];
type MapOverlayRow = OverlayLocationRow["overlay"] & {
  ownProposal: ReturnType<typeof buildOwnOverlayProposal>;
};
type MapProjectRow = OverlayLocationRow["project"] & {
  importSource: OverlayLocationRow["importSource"];
};

function fetchOverlayLocationRows(database: DatabaseExecutor, whereConditions: SQL[]) {
  return database
    .select({
      overlay: OVERLAY_COLUMNS,
      project: PROJECT_COLUMNS,
      importSource: IMPORT_SOURCE_COLUMNS,
    })
    .from(overlays)
    .innerJoin(projects, eq(projects.id, overlays.projectId))
    .leftJoin(importSources, eq(importSources.id, projects.importSourceId))
    .where(and(eq(overlays.kind, "map"), ...whereConditions))
    .orderBy(overlays.createdAt);
}

// The caller's own open overlay change requests, grouped by overlay id.
async function fetchOwnOverlayChangeRequests(
  database: DatabaseExecutor,
  user: UserContext,
  overlayIds: string[],
): Promise<Map<string, OverlayChangeValue[]>> {
  const changeRequestsByOverlay = new Map<string, OverlayChangeValue[]>();
  if (!user || overlayIds.length === 0) return changeRequestsByOverlay;

  const changeRequestsData = await database
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
        inArray(changeRequests.entityId, overlayIds),
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

export async function fetchModerationMapOverlays(overlayIds: string[]) {
  if (overlayIds.length === 0) return [];

  const rows = await db
    .select(OVERLAY_COLUMNS)
    .from(overlays)
    .where(and(eq(overlays.kind, "map"), inArray(overlays.id, overlayIds)))
    .orderBy(overlays.createdAt);
  return rows;
}

// Fetch overlays matching the given WHERE conditions, their parent projects, and the caller's own
// open change requests (never another requester's, whatever mode is asking).
export async function fetchOverlaysForMap(
  database: DatabaseExecutor,
  whereConditions: SQL[],
  user: UserContext,
) {
  const overlaysData = await fetchOverlayLocationRows(database, whereConditions);
  const changeRequestsByOverlay = await fetchOwnOverlayChangeRequests(
    database,
    user,
    overlaysData.map((row) => row.overlay.id),
  );

  const mapOverlays: MapOverlayRow[] = [];
  const projectsById = new Map<string, MapProjectRow>();

  for (const row of overlaysData) {
    mapOverlays.push({
      ...row.overlay,
      ownProposal: buildOwnOverlayProposal(changeRequestsByOverlay.get(row.overlay.id) ?? []),
    });
    projectsById.set(row.project.id, { ...row.project, importSource: row.importSource });
  }

  return { overlays: mapOverlays, projects: [...projectsById.values()] };
}

export function isModeratorOrAdmin(user: UserContext): boolean {
  if (!user) return false;

  const isAdmin = user.role === "admin";
  const isModerator =
    user.moderatedCountries !== null &&
    user.moderatedCountries !== undefined &&
    user.moderatedCountries.length > 0;

  return isAdmin || isModerator;
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
