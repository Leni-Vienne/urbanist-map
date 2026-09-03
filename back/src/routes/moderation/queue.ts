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
  fetchModerationMapOverlays,
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
    .input(z.object({ countryCode: z.string().length(3) }))
    .query(async ({ input, ctx }) => {
      try {
        const userModeratedCountries = ctx.user.moderatedCountries;
        const isAdmin = ctx.user.role === "admin";
        const moderatorId = ctx.user.id;

        // Early permission check - validate country access before any DB queries.
        // moderatorProcedure guarantees a non-admin has a non-empty moderatedCountries,
        // so the country gate applies to every non-admin (fail closed via ?. below).
        if (!isAdmin) {
          if (!userModeratedCountries?.includes(input.countryCode)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have permission to moderate this country",
            });
          }
        }

        const hiddenUserIds = await buildHiddenUserIdsSet(moderatorId);

        const projectModerationConditions = [
          or(
            eq(projects.status, "pending"),
            sql`EXISTS (
              SELECT 1 FROM ${overlays}
              WHERE ${overlays.projectId} = ${projects.id}
                AND ${overlays.status} = 'pending'
            )`,
            sql`EXISTS (
              SELECT 1 FROM ${changeRequests}
              WHERE ${changeRequests.status} = 'pending'
                AND (
                  (${changeRequests.entityType} = 'project' AND ${changeRequests.entityId} = ${projects.id})
                  OR (
                    ${changeRequests.entityType} = 'overlay'
                    AND EXISTS (
                      SELECT 1 FROM ${overlays}
                      WHERE ${overlays.id} = ${changeRequests.entityId}
                        AND ${overlays.projectId} = ${projects.id}
                    )
                  )
                )
            )`,
          ),
          eq(projects.countryCode, input.countryCode),
        ];

        const { projectsResult, overlaysResult, overlayChanges, projectChanges } =
          await fetchModerationData(projectModerationConditions);

        const changeRequestsResult = [...overlayChanges, ...projectChanges].toSorted(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );

        // Filter out rejected and replaced overlays
        const visibleOverlays = overlaysResult.filter(
          (overlay) => overlay.status !== "rejected" && overlay.status !== "replaced",
        );

        // Filter by reported users
        const ownerVisibleProjects = filterContentByReportedUsers(
          projectsResult,
          hiddenUserIds,
          "ownerId",
        );
        const ownerVisibleProjectIds = new Set(ownerVisibleProjects.map((project) => project.id));
        const authorVisibleOverlays = filterContentByReportedUsers(
          visibleOverlays,
          hiddenUserIds,
          "authorId",
        ).filter(
          (overlay) => overlay.projectId !== null && ownerVisibleProjectIds.has(overlay.projectId),
        );
        const visibleOverlayIds = new Set(authorVisibleOverlays.map((overlay) => overlay.id));
        const overlayProjectById = new Map(
          authorVisibleOverlays.flatMap((overlay) =>
            overlay.projectId === null ? [] : [[overlay.id, overlay.projectId] as const],
          ),
        );
        const requesterVisibleChanges = filterContentByReportedUsers(
          changeRequestsResult,
          hiddenUserIds,
          "requestedBy",
        ).filter((change) =>
          change.entityType === "project"
            ? ownerVisibleProjectIds.has(change.entityId)
            : visibleOverlayIds.has(change.entityId),
        );
        const filteredChangeRequests = addConflictFlags(requesterVisibleChanges);

        const actionableProjectIds = new Set(
          ownerVisibleProjects
            .filter((project) => project.status === "pending")
            .map((project) => project.id),
        );
        for (const overlay of authorVisibleOverlays) {
          if (overlay.status === "pending" && overlay.projectId !== null) {
            actionableProjectIds.add(overlay.projectId);
          }
        }
        for (const change of filteredChangeRequests) {
          const projectId =
            change.entityType === "project"
              ? change.entityId
              : overlayProjectById.get(change.entityId);
          if (projectId) actionableProjectIds.add(projectId);
        }

        const filteredProjects = ownerVisibleProjects.filter((project) =>
          actionableProjectIds.has(project.id),
        );
        const filteredProjectIds = new Set(filteredProjects.map((project) => project.id));
        const filteredOverlays = authorVisibleOverlays.filter(
          (overlay) => overlay.projectId !== null && filteredProjectIds.has(overlay.projectId),
        );

        const changedOverlayIds = new Set(
          filteredChangeRequests
            .filter((change) => change.entityType === "overlay")
            .map((change) => change.entityId),
        );
        const mapOverlayIds = filteredOverlays
          .filter(
            (overlay) =>
              overlay.kind === "map" &&
              overlay.projectId !== null &&
              filteredProjectIds.has(overlay.projectId) &&
              (overlay.status === "pending" || changedOverlayIds.has(overlay.id)),
          )
          .map((overlay) => overlay.id);

        const [mapOverlays, collections] = await Promise.all([
          fetchModerationMapOverlays(mapOverlayIds),
          normalizeModerationCollections(
            filteredProjects,
            filteredOverlays,
            filteredChangeRequests,
          ),
        ]);

        return {
          ...collections,
          mapOverlays,
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

async function normalizeModerationCollections(
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

  const projectsById: Record<
    string,
    (typeof filteredProjects)[number] & { ownerReportCount: number }
  > = {};
  const overlaysById: Record<
    string,
    (typeof filteredOverlays)[number] & { authorReportCount: number }
  > = {};

  for (const project of filteredProjects) {
    projectsById[project.id] = {
      ...project,
      ownerReportCount: project.ownerId ? (reportCountMap.get(project.ownerId) ?? 0) : 0,
    };
  }
  for (const overlay of filteredOverlays) {
    overlaysById[overlay.id] = {
      ...overlay,
      authorReportCount: overlay.authorId ? (reportCountMap.get(overlay.authorId) ?? 0) : 0,
    };
  }

  const changeRequestsWithReports = [];
  for (const change of filteredChangeRequests) {
    const requestedByReportCount = change.requestedBy
      ? (reportCountMap.get(change.requestedBy) ?? 0)
      : 0;
    changeRequestsWithReports.push({ ...change, requestedByReportCount });
  }

  return {
    projectsById,
    overlaysById,
    changeRequests: changeRequestsWithReports,
  };
}
