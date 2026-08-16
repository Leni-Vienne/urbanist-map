import { moderatorProcedure } from "../../trpc";
import { checkModeratorOverlayPermission } from "./shared";
import { db } from "../../database";
import {
  projects,
  overlays,
  changeRequests,
  users,
  userReports,
  type EntityType,
} from "../../db/schema";
import { and, eq, or, sql, inArray, ne, type SQL } from "drizzle-orm";
import {
  buildProjectModerationQuery,
  buildOverlayModerationQuery,
  addConflictFlags,
} from "../../db/helpers";
import { TRPCError } from "@trpc/server";
import * as z from "zod";

export const queueProcedures = {
  checkReplacementConflicts: moderatorProcedure
    .input(z.object({ overlayId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      try {
        await checkModeratorOverlayPermission(input.overlayId, ctx.user);
        const overlay = await db
          .select({
            id: overlays.id,
            replacesOverlayId: overlays.replacesOverlayId,
            filename: overlays.filename,
            caption: overlays.caption,
            projectId: overlays.projectId,
          })
          .from(overlays)
          .where(eq(overlays.id, input.overlayId))
          .limit(1);

        const overlayRecord = overlay[0];

        if (!overlayRecord) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
        }

        const replacesOverlayId = overlayRecord.replacesOverlayId;

        if (!replacesOverlayId || !overlayRecord.projectId) {
          return null;
        }

        const originalOverlay = await db
          .select({
            id: overlays.id,
            status: overlays.status,
            caption: overlays.caption,
            filename: overlays.filename,
          })
          .from(overlays)
          .where(
            and(
              eq(overlays.id, replacesOverlayId),
              eq(overlays.projectId, overlayRecord.projectId),
            ),
          )
          .limit(1);

        const originalRecord = originalOverlay[0];
        if (originalRecord?.status !== "approved") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot replace overlay that is not approved",
          });
        }

        const pendingChanges = await db
          .select({
            id: changeRequests.id,
            fieldName: changeRequests.fieldName,
            oldValue: changeRequests.oldValue,
            newValue: changeRequests.newValue,
            changeReason: changeRequests.changeReason,
          })
          .from(changeRequests)
          .where(
            and(
              eq(changeRequests.entityType, "overlay"),
              eq(changeRequests.entityId, replacesOverlayId),
              eq(changeRequests.status, "pending"),
            ),
          );

        // Find competing replacement overlays (other pending overlays trying to replace the same original)
        const competingReplacements = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            caption: overlays.caption,
            createdAt: overlays.createdAt,
          })
          .from(overlays)
          .where(
            and(
              eq(overlays.replacesOverlayId, replacesOverlayId),
              eq(overlays.projectId, overlayRecord.projectId),
              eq(overlays.status, "pending"),
              ne(overlays.id, input.overlayId),
            ),
          );

        if (pendingChanges.length === 0 && competingReplacements.length === 0) {
          return null;
        }

        return {
          originalOverlayCaption: originalRecord.caption,
          originalOverlayFilename: originalRecord.filename,
          newOverlayFilename: overlayRecord.filename,
          newOverlayCaption: overlayRecord.caption,
          pendingChangeRequests: pendingChanges,
          competingReplacements,
        };
      } catch (error) {
        console.error("Error checking replacement conflicts:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to check replacement conflicts",
        });
      }
    }),

  getPendingSubmissions: moderatorProcedure
    .input(
      z
        .object({
          countryCode: z.string().length(3).optional(),
        })
        .optional(),
    )
    .query(async ({ input = {}, ctx }) => {
      try {
        const userModeratedCountries = ctx.user.moderatedCountries;
        const isAdmin = ctx.user.role === "admin";
        const moderatorId = ctx.user.id;

        // Early permission check - validate country access before any DB queries.
        // moderatorProcedure guarantees a non-admin has a non-empty moderatedCountries,
        // so the country gate applies to every non-admin (fail closed via ?. below).
        const effectiveCountryCode = input.countryCode;

        if (!isAdmin) {
          if (!input.countryCode) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Moderators must select a country to moderate",
            });
          }

          if (!userModeratedCountries?.includes(input.countryCode)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have permission to moderate this country",
            });
          }
        }

        const [hiddenUserIds, pendingProjectIds] = await Promise.all([
          buildHiddenUserIdsSet(moderatorId),
          collectPendingProjectIds(),
        ]);

        const projectModerationConditions = [
          or(
            eq(projects.status, "pending"),
            ...(pendingProjectIds.pendingOverlayProjectIds.length > 0
              ? [inArray(projects.id, pendingProjectIds.pendingOverlayProjectIds)]
              : []),
            ...(pendingProjectIds.pendingChangeProjectIds.length > 0
              ? [inArray(projects.id, pendingProjectIds.pendingChangeProjectIds)]
              : []),
          ),
          effectiveCountryCode ? eq(projects.countryCode, effectiveCountryCode) : undefined,
        ];

        const { projectsResult, overlaysResult, overlayChanges, projectChanges } =
          await fetchModerationData(projectModerationConditions);

        const changeRequestsResult = [...overlayChanges, ...projectChanges].toSorted(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );

        const changeRequestsWithConflictInfo = addConflictFlags(changeRequestsResult);

        // Filter out rejected and replaced overlays
        const visibleOverlays = overlaysResult.filter(
          (overlay) => overlay.status !== "rejected" && overlay.status !== "replaced",
        );

        // Filter by reported users
        const filteredProjects = filterContentByReportedUsers(
          projectsResult,
          hiddenUserIds,
          "ownerId",
        );
        const filteredOverlays = filterContentByReportedUsers(
          visibleOverlays,
          hiddenUserIds,
          "authorId",
        );
        const filteredChangeRequests = filterContentByReportedUsers(
          changeRequestsWithConflictInfo,
          hiddenUserIds,
          "requestedBy",
        );

        const { projectsWithOverlays, changeRequestsWithReports } = await enrichWithReportCounts(
          filteredProjects,
          filteredOverlays,
          filteredChangeRequests,
        );

        return {
          projects: projectsWithOverlays,
          changeRequests: changeRequestsWithReports,
        };
      } catch (error) {
        console.error("Error fetching pending submissions:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch pending submissions",
        });
      }
    }),

  getPendingCountsByCountry: moderatorProcedure.query(async ({ ctx }) => {
    try {
      const userModeratedCountries = ctx.user.moderatedCountries;
      const isAdmin = ctx.user.role === "admin";

      // moderatorProcedure guarantees a non-admin has a non-empty moderatedCountries.
      let countryFilter: SQL | undefined = sql`${projects.countryCode} IS NOT NULL`;
      if (!isAdmin) {
        const allowed = userModeratedCountries ?? [];
        countryFilter = sql`${projects.countryCode} = ANY(ARRAY[${sql.join(
          allowed.map((c) => sql`${c}`),
          sql`, `,
        )}]::text[])`;
      }

      // Count each pending entity type with its own simple GROUP BY, then sum
      // them per country. Counting separately avoids the combinatorial row
      // fan-out of joining projects x overlays x changeRequests in one query.
      const countByCountry = sql<string>`COUNT(*)`.as("count");

      const pendingProjects = db
        .select({ countryCode: projects.countryCode, count: countByCountry })
        .from(projects)
        .where(and(eq(projects.status, "pending"), countryFilter))
        .groupBy(projects.countryCode);

      const pendingOverlays = db
        .select({ countryCode: projects.countryCode, count: countByCountry })
        .from(overlays)
        .innerJoin(projects, eq(overlays.projectId, projects.id))
        .where(and(eq(overlays.status, "pending"), countryFilter))
        .groupBy(projects.countryCode);

      const pendingProjectChanges = db
        .select({ countryCode: projects.countryCode, count: countByCountry })
        .from(changeRequests)
        .innerJoin(projects, eq(changeRequests.entityId, projects.id))
        .where(
          and(
            eq(changeRequests.entityType, "project"),
            eq(changeRequests.status, "pending"),
            countryFilter,
          ),
        )
        .groupBy(projects.countryCode);

      const pendingOverlayChanges = db
        .select({ countryCode: projects.countryCode, count: countByCountry })
        .from(changeRequests)
        .innerJoin(overlays, eq(changeRequests.entityId, overlays.id))
        .innerJoin(projects, eq(overlays.projectId, projects.id))
        .where(
          and(
            eq(changeRequests.entityType, "overlay"),
            eq(changeRequests.status, "pending"),
            countryFilter,
          ),
        )
        .groupBy(projects.countryCode);

      const pending = pendingProjects
        .unionAll(pendingOverlays)
        .unionAll(pendingProjectChanges)
        .unionAll(pendingOverlayChanges)
        .as("pending");

      const result = await db
        .select({
          countryCode: pending.countryCode,
          total: sql<string>`SUM(${pending.count})`,
        })
        .from(pending)
        .groupBy(pending.countryCode);

      return result
        .map((row) => ({ countryCode: row.countryCode, total: Number(row.total) }))
        .filter((row) => row.total > 0);
    } catch (error) {
      console.error("Error fetching pending counts by country:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch pending counts",
      });
    }
  }),
};

async function buildHiddenUserIdsSet(moderatorId: string): Promise<Set<string>> {
  // One grouped row per reported user instead of loading the whole user_reports table.
  // A user is hidden if this moderator reported them, or 3+ moderators reported them.
  const rows = await db
    .select({
      reportedUserId: userReports.reportedUserId,
      reportCount: sql<number>`count(*)::int`,
      reportedByMe: sql<boolean>`bool_or(${userReports.reportedBy} = ${moderatorId})`,
    })
    .from(userReports)
    .groupBy(userReports.reportedUserId);

  const hiddenUserIds = new Set<string>();
  for (const row of rows) {
    if (row.reportedByMe || row.reportCount >= 3) {
      hiddenUserIds.add(row.reportedUserId);
    }
  }

  return hiddenUserIds;
}

async function collectPendingProjectIds(): Promise<{
  pendingOverlayProjectIds: string[];
  pendingChangeProjectIds: string[];
}> {
  const [projectsWithPendingOverlays, projectsWithPendingChanges] = await Promise.all([
    db
      .selectDistinct({ projectId: overlays.projectId })
      .from(overlays)
      .where(eq(overlays.status, "pending")),
    db
      .selectDistinct({
        projectId: sql<string>`CASE
          WHEN ${changeRequests.entityType} = 'project' THEN ${changeRequests.entityId}
          WHEN ${changeRequests.entityType} = 'overlay' THEN ${overlays.projectId}
        END`.as("projectId"),
      })
      .from(changeRequests)
      .leftJoin(overlays, eq(changeRequests.entityId, overlays.id))
      .where(
        and(
          eq(changeRequests.status, "pending"),
          sql`CASE
            WHEN ${changeRequests.entityType} = 'project' THEN ${changeRequests.entityId} IS NOT NULL
            WHEN ${changeRequests.entityType} = 'overlay' THEN ${overlays.projectId} IS NOT NULL
          END`,
        ),
      ),
  ]);

  const pendingOverlayProjectIds = projectsWithPendingOverlays
    .map((p) => p.projectId)
    .filter((id) => id !== null);

  const pendingChangeProjectIds = projectsWithPendingChanges.map((p) => p.projectId);

  return { pendingOverlayProjectIds, pendingChangeProjectIds };
}

async function fetchModerationData(projectModerationConditions: (SQL | undefined)[]) {
  // Fetch projects first to scope change request queries to exact project IDs,
  // avoiding slow full-table scans via COALESCE country conditions on the join
  const projectsResult = await buildProjectModerationQuery(db)
    .where(and(...projectModerationConditions))
    .orderBy(sql`${projects.createdAt} DESC`, sql`${projects.id} DESC`);

  const projectIds = projectsResult.map((p) => p.id);

  if (projectIds.length === 0) {
    return { projectsResult, overlaysResult: [], overlayChanges: [], projectChanges: [] };
  }

  const [overlaysResult, overlayChanges, projectChanges] = await Promise.all([
    buildOverlayModerationQuery(db).where(inArray(overlays.projectId, projectIds)),
    // Overlay change requests scoped to the fetched project IDs
    db
      .select({
        id: changeRequests.id,
        entityType: changeRequests.entityType,
        entityId: changeRequests.entityId,
        fieldName: changeRequests.fieldName,
        oldValue: changeRequests.oldValue,
        newValue: changeRequests.newValue,
        changeReason: changeRequests.changeReason,
        status: changeRequests.status,
        requestedBy: changeRequests.requestedBy,
        requestedByUsername: users.username,
        createdAt: changeRequests.createdAt,
      })
      .from(changeRequests)
      .leftJoin(overlays, eq(changeRequests.entityId, overlays.id))
      .leftJoin(users, eq(changeRequests.requestedBy, users.id))
      .where(
        and(
          eq(changeRequests.entityType, "overlay"),
          eq(changeRequests.status, "pending"),
          inArray(overlays.projectId, projectIds),
        ),
      ),

    db
      .select({
        id: changeRequests.id,
        entityType: changeRequests.entityType,
        entityId: changeRequests.entityId,
        fieldName: changeRequests.fieldName,
        oldValue: changeRequests.oldValue,
        newValue: changeRequests.newValue,
        changeReason: changeRequests.changeReason,
        status: changeRequests.status,
        requestedBy: changeRequests.requestedBy,
        requestedByUsername: users.username,
        createdAt: changeRequests.createdAt,
      })
      .from(changeRequests)
      .leftJoin(users, eq(changeRequests.requestedBy, users.id))
      .where(
        and(
          eq(changeRequests.entityType, "project"),
          eq(changeRequests.status, "pending"),
          inArray(changeRequests.entityId, projectIds),
        ),
      ),
  ]);

  return { projectsResult, overlaysResult, overlayChanges, projectChanges };
}

function filterContentByReportedUsers<
  T extends { ownerId?: string | null; authorId?: string | null; requestedBy?: string | null },
>(items: T[], hiddenUserIds: Set<string>, userIdField: keyof T): T[] {
  return items.filter((item) => {
    const userId = item[userIdField];
    if (typeof userId !== "string") return true;
    return !hiddenUserIds.has(userId);
  });
}

async function enrichWithReportCounts(
  filteredProjects: Awaited<ReturnType<ReturnType<typeof buildProjectModerationQuery>["execute"]>>,
  filteredOverlays: Awaited<ReturnType<ReturnType<typeof buildOverlayModerationQuery>["execute"]>>,
  filteredChangeRequests: {
    id: string;
    entityType: EntityType;
    entityId: string;
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
    changeReason: string | null;
    status: "pending" | "approved" | "rejected" | "conflicted";
    requestedBy: string | null;
    requestedByUsername: string | null;
    createdAt: Date;
    hasConflict: boolean;
  }[],
) {
  const userIds = new Set<string>();
  for (const project of filteredProjects) {
    if (project.ownerId) userIds.add(project.ownerId);
  }
  for (const overlay of filteredOverlays) {
    if (overlay.authorId) userIds.add(overlay.authorId);
  }
  for (const change of filteredChangeRequests) {
    if (change.requestedBy) userIds.add(change.requestedBy);
  }

  const reportCountMap = new Map<string, number>();
  if (userIds.size > 0) {
    const reportCounts = await db
      .select({
        reportedUserId: userReports.reportedUserId,
        count: sql<string>`COUNT(*)`,
      })
      .from(userReports)
      .where(inArray(userReports.reportedUserId, [...userIds]))
      .groupBy(userReports.reportedUserId);

    for (const row of reportCounts) {
      reportCountMap.set(row.reportedUserId, Number(row.count));
    }
  }

  const overlaysWithReports = filteredOverlays.map((overlay) =>
    Object.assign(overlay, {
      authorReportCount: overlay.authorId ? (reportCountMap.get(overlay.authorId) ?? 0) : 0,
    }),
  );

  const projectsWithOverlays = filteredProjects.map((project) =>
    Object.assign(project, {
      ownerReportCount: project.ownerId ? (reportCountMap.get(project.ownerId) ?? 0) : 0,
      overlays: overlaysWithReports.filter((overlay) => overlay.projectId === project.id),
    }),
  );

  const changeRequestsWithReports = filteredChangeRequests.map((change) => {
    const requestedByReportCount = change.requestedBy
      ? (reportCountMap.get(change.requestedBy) ?? 0)
      : 0;
    return Object.assign(change, { requestedByReportCount });
  });

  return { projectsWithOverlays, changeRequestsWithReports };
}
