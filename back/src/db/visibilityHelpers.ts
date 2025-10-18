import { sql, eq, and, SQL, inArray } from 'drizzle-orm';
import { projects, overlays, changeRequests } from './schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

// AI : Type for user context from tRPC (can be undefined or null)
export type UserContext = {
  id: string;
  role?: string | null;
} | undefined | null;

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

// AI : Build WHERE condition for project visibility based on user context and view mode
export function buildProjectVisibilityCondition(
  user: UserContext,
  viewMode: boolean
): SQL {
  if (user && !viewMode) {
    // AI : Edit mode: show approved projects OR user's own projects (any status)
    return sql`(${projects.status} = 'approved' OR ${projects.ownerId} = ${user.id})`;
  } else {
    // AI : View mode or anonymous: only show approved projects
    return eq(projects.status, 'approved');
  }
}

// AI : Build WHERE condition for overlay visibility based on user context and view mode
// AI : Can also handle admin includeStatus filter (takes precedence over viewMode logic)
export function buildOverlayVisibilityCondition(
  user: UserContext,
  viewMode: boolean,
  overlayChangeRequestIds?: string[],
  adminIncludeStatus?: ApprovalStatus[]
): SQL {
  // AI : Admin status filter takes precedence
  if (adminIncludeStatus && user?.role === 'admin' && adminIncludeStatus.length > 0) {
    return inArray(overlays.status, adminIncludeStatus);
  }

  if (user && !viewMode) {
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
  } else {
    // AI : View mode or anonymous: only show approved overlays
    return eq(overlays.status, 'approved');
  }
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
// AI : This ensures we don't show empty non-development projects
export function buildProjectHasVisibleContentCondition(
  user: UserContext,
  viewMode: boolean,
  overlayChangeRequestIds?: string[]
): SQL {
  if (user && !viewMode) {
    // AI : Edit mode: show if development OR has approved overlays OR has user's own overlays OR has user's change requests
    if (overlayChangeRequestIds && overlayChangeRequestIds.length > 0) {
      const idsArray = `{${overlayChangeRequestIds.join(',')}}`;
      return sql`(
        ${projects.isDevelopment} = true
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
        OR EXISTS (
          SELECT 1 FROM ${overlays}
          WHERE ${overlays.projectId} = ${projects.id}
          AND (${overlays.status} = 'approved' OR ${overlays.authorId} = ${user.id})
        )
      )`;
    }
  } else {
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
}
