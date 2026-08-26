import { sql, eq, and, inArray, type SQL } from "drizzle-orm";
import { db, type Database, type DatabaseExecutor } from "../database";
import {
  projects,
  overlays,
  adminBoundaries,
  changeRequests,
  users,
  userReports,
  importSources,
} from "./schema";
import type { AppMode } from "@shared/types";

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

// Full administrative breadcrumb (deepest boundary up to the country), deepest-first, mirroring
// project.getById's resolveBoundaryPath so list views render the same location as the detail panel.
// Walks the parent chain from the project's assigned boundary. NULL boundary or no chain yields [].
// The depth guard stops a malformed parent cycle from looping forever.
function boundaryPathSql(requestLanguage: string): SQL<
  {
    name: string;
    nameEn: string | null;
    names: Record<string, string> | null;
    adminLevel: number;
  }[]
> {
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

// Name variants of one boundary. Shipping every locale the UI can render, rather than a single
// resolved name, keeps a response free of a locale param and its cached pages locale-agnostic.
export type LocalizedBoundaryName = {
  name: string; // OSM `name` (usually local language)
  nameEn: string | null; // OSM `name:en`
  names: Record<string, string> | null; // `name:*` variants for BOUNDARY_NAME_LOCALES
};

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

export function buildProjectWithLocationQuery(database: Database, requestLanguage: string) {
  return database
    .select({
      ...PROJECT_COLUMNS,
      countryName: countryNameSql,
      boundaryPath: boundaryPathSql(requestLanguage),
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
  return database
    .select({
      ...PROJECT_COLUMNS,
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
  database: DatabaseExecutor,
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

export function buildOverlayVisibilityCondition(
  user: UserContext,
  mode: AppMode,
  overlayChangeRequestIds?: string[],
): SQL {
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

type OverlayChangeValue = { fieldName: string; newValue: unknown };
const OVERLAY_LOCATION_COLUMNS = {
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
};

type OverlayLocationRow = Awaited<ReturnType<typeof fetchOverlayLocationRows>>[number];
type OverlayGeometryRow = Pick<OverlayLocationRow, keyof typeof OVERLAY_LOCATION_COLUMNS>;
type MapProjectRow = OverlayLocationRow["project"] & {
  importSource: OverlayLocationRow["importSource"];
};

async function fetchOverlayLocationRows(database: DatabaseExecutor, whereConditions: SQL[]) {
  return await database
    .select({
      ...OVERLAY_LOCATION_COLUMNS,
      project: {
        ...PROJECT_COLUMNS,
      },
      importSource: importSources,
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
): Promise<Map<string, OverlayChangeValue[]>> {
  const changeRequestsByOverlay = new Map<string, OverlayChangeValue[]>();
  if (!user) return changeRequestsByOverlay;

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

function isCorner(value: unknown): value is { lat: number; lng: number } {
  if (typeof value !== "object" || value === null) return false;
  return (
    "lat" in value &&
    "lng" in value &&
    typeof value.lat === "number" &&
    typeof value.lng === "number"
  );
}

function transformOverlayRow(row: OverlayGeometryRow, overlayChangeRequests: OverlayChangeValue[]) {
  const newCorners = overlayChangeRequests.find((cr) => cr.fieldName === "corners")?.newValue;
  const suggestedCorners =
    Array.isArray(newCorners) && newCorners.every(isCorner) ? newCorners : null;

  const captionValue = overlayChangeRequests.find((cr) => cr.fieldName === "caption")?.newValue;
  const suggestedCaption =
    captionValue === null || captionValue === undefined ? null : String(captionValue);

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
    centroid: { lat: row.centroidLat, lng: row.centroidLng },
    corners: row.corners,
    suggestedCorners: suggestedCorners ?? undefined,
    suggestedCaption: suggestedCaption ?? undefined,
    hasPendingChanges: overlayChangeRequests.length > 0,
  };
}

function transformOverlayDataWithChangeRequests(
  overlaysData: Awaited<ReturnType<typeof fetchOverlaysWithLocation>>,
  changeRequestsByOverlay: Map<string, OverlayChangeValue[]>,
) {
  const transformedOverlays: ReturnType<typeof transformOverlayRow>[] = [];
  const projectsById = new Map<string, MapProjectRow>();

  for (const row of overlaysData) {
    transformedOverlays.push(
      transformOverlayRow(row, changeRequestsByOverlay.get(row.overlayId) ?? []),
    );
    projectsById.set(row.project.id, {
      ...row.project,
      importSource: row.importSource,
    });
  }

  return { overlays: transformedOverlays, projects: [...projectsById.values()] };
}

export async function fetchOverlaysWithLocation(
  database: DatabaseExecutor,
  whereConditions: SQL[],
) {
  return fetchOverlayLocationRows(database, whereConditions);
}

export async function fetchModerationMapOverlays(overlayIds: string[]) {
  if (overlayIds.length === 0) return [];

  const rows = await db
    .select(OVERLAY_LOCATION_COLUMNS)
    .from(overlays)
    .where(and(eq(overlays.kind, "map"), inArray(overlays.id, overlayIds)))
    .orderBy(overlays.createdAt);

  return rows.map((row) => transformOverlayRow(row, []));
}

// Fetch overlays matching the given WHERE conditions, their parent projects, and the caller's own
// open change requests (never another requester's, whatever mode is asking).
export async function fetchOverlaysForMap(
  database: DatabaseExecutor,
  whereConditions: SQL[],
  user: UserContext,
) {
  const overlaysData = await fetchOverlaysWithLocation(database, whereConditions);
  const changeRequestsByOverlay = await fetchOwnOverlayChangeRequests(database, user);

  return transformOverlayDataWithChangeRequests(overlaysData, changeRequestsByOverlay);
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
