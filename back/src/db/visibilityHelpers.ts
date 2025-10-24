import { sql, eq, and, SQL, inArray } from 'drizzle-orm';
import { projects, overlays, changeRequests } from './schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

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
