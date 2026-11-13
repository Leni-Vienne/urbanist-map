import { moderatorProcedure } from "../../trpc";
import { checkModeratorOverlayPermission } from "./shared";
import { db } from "../../database";
import { projects, overlays, changeRequests, users, userReports } from "../../db/schema";
import { and, eq, sql, inArray, ne, or, isNull, notInArray, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
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
    .input(z.object({ overlayId: z.uuid() }))
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
        if (!isAdmin && !userModeratedCountries?.includes(input.countryCode)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You do not have permission to moderate this country",
          });
        }

        const { hiddenUserIds, reportCounts } = await fetchUserReports(moderatorId);

        const pending = buildPendingModerationQuery(
          eq(projects.countryCode, input.countryCode),
          hiddenUserIds,
        ).as("pending");
        const { projectsResult, overlaysResult, overlayChanges, projectChanges } =
          await fetchModerationData(
            inArray(projects.id, db.select({ projectId: pending.projectId }).from(pending)),
            hiddenUserIds,
          );
        const changes = addConflictFlags(
          [...overlayChanges, ...projectChanges].toSorted(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          ),
        );
        const changedOverlayIds = new Set(
          changes
            .filter((change) => change.entityType === "overlay")
            .map((change) => change.entityId),
        );
        const mapOverlayIds = overlaysResult
          .filter(
            (overlay) =>
              overlay.kind === "map" &&
              (overlay.status === "pending" || changedOverlayIds.has(overlay.id)),
          )
          .map((overlay) => overlay.id);

        return {
          ...normalizeModerationCollections(projectsResult, overlaysResult, changes, reportCounts),
          mapOverlays: await fetchModerationMapOverlays(mapOverlayIds),
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
      let countryFilter: SQL = sql`${projects.countryCode} IS NOT NULL`;
      if (!isAdmin) {
        const allowed = userModeratedCountries ?? [];
        countryFilter = sql`${projects.countryCode} = ANY(ARRAY[${sql.join(
          allowed.map((c) => sql`${c}`),
          sql`, `,
        )}]::text[])`;
      }

      const { hiddenUserIds } = await fetchUserReports(ctx.user.id);
      const pending = buildPendingModerationQuery(countryFilter, hiddenUserIds).as("pending");
      return await db
        .select({ countryCode: pending.countryCode, total: sql<number>`COUNT(*)::int` })
        .from(pending)
        .groupBy(pending.countryCode);
    } catch (error) {
      console.error("Error fetching pending counts by country:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch pending counts",
      });
    }
  }),
};

async function fetchUserReports(moderatorId: string) {
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
  const reportCounts = new Map<string, number>();
  for (const row of rows) {
    reportCounts.set(row.reportedUserId, row.reportCount);
    if (row.reportedByMe || row.reportCount >= 3) {
      hiddenUserIds.add(row.reportedUserId);
    }
  }

  return { hiddenUserIds, reportCounts };
}

function moderationVisibility(hiddenUserIds: ReadonlySet<string>) {
  const hidden = [...hiddenUserIds];
  function visibleUser(column: AnyPgColumn) {
    return hidden.length > 0 ? or(isNull(column), notInArray(column, hidden)) : undefined;
  }
  return {
    project: visibleUser(projects.ownerId),
    overlay: and(
      notInArray(overlays.status, ["rejected", "replaced"]),
      visibleUser(overlays.authorId),
    ),
    change: visibleUser(changeRequests.requestedBy),
  };
}

// One row per actionable entity. Both project membership and country badges read this relation.
function buildPendingModerationQuery(countryFilter: SQL, hiddenUserIds: ReadonlySet<string>) {
  const visible = moderationVisibility(hiddenUserIds);
  const columns = { projectId: projects.id, countryCode: projects.countryCode };
  const scope = and(countryFilter, visible.project);
  return db
    .select(columns)
    .from(projects)
    .where(and(eq(projects.status, "pending"), scope))
    .unionAll(
      db
        .select(columns)
        .from(overlays)
        .innerJoin(projects, eq(overlays.projectId, projects.id))
        .where(and(eq(overlays.status, "pending"), scope, visible.overlay)),
    )
    .unionAll(
      db
        .select(columns)
        .from(changeRequests)
        .innerJoin(projects, eq(changeRequests.entityId, projects.id))
        .where(
          and(
            eq(changeRequests.entityType, "project"),
            eq(changeRequests.status, "pending"),
            scope,
            visible.change,
          ),
        ),
    )
    .unionAll(
      db
        .select(columns)
        .from(changeRequests)
        .innerJoin(overlays, eq(changeRequests.entityId, overlays.id))
        .innerJoin(projects, eq(overlays.projectId, projects.id))
        .where(
          and(
            eq(changeRequests.entityType, "overlay"),
            eq(changeRequests.status, "pending"),
            scope,
            visible.overlay,
            visible.change,
          ),
        ),
    );
}

async function fetchModerationData(projectCondition: SQL, hiddenUserIds: ReadonlySet<string>) {
  const visible = moderationVisibility(hiddenUserIds);
  // Fetch projects first to scope change request queries to exact project IDs,
  // avoiding slow full-table scans via COALESCE country conditions on the join
  const projectsResult = await buildProjectModerationQuery(db)
    .where(projectCondition)
    .orderBy(sql`${projects.createdAt} DESC`, sql`${projects.id} DESC`);

  const projectIds = projectsResult.map((p) => p.id);

  if (projectIds.length === 0) {
    return { projectsResult, overlaysResult: [], overlayChanges: [], projectChanges: [] };
  }

  const changeColumns = {
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
  };
  const [overlaysResult, overlayChanges, projectChanges] = await Promise.all([
    buildOverlayModerationQuery(db).where(
      and(inArray(overlays.projectId, projectIds), visible.overlay),
    ),
    // Overlay change requests scoped to the fetched project IDs
    db
      .select(changeColumns)
      .from(changeRequests)
      .leftJoin(overlays, eq(changeRequests.entityId, overlays.id))
      .leftJoin(users, eq(changeRequests.requestedBy, users.id))
      .where(
        and(
          eq(changeRequests.entityType, "overlay"),
          eq(changeRequests.status, "pending"),
          inArray(overlays.projectId, projectIds),
          visible.overlay,
          visible.change,
        ),
      ),

    db
      .select(changeColumns)
      .from(changeRequests)
      .leftJoin(users, eq(changeRequests.requestedBy, users.id))
      .where(
        and(
          eq(changeRequests.entityType, "project"),
          eq(changeRequests.status, "pending"),
          inArray(changeRequests.entityId, projectIds),
          visible.change,
        ),
      ),
  ]);

  return { projectsResult, overlaysResult, overlayChanges, projectChanges };
}

type ModerationData = Awaited<ReturnType<typeof fetchModerationData>>;

function normalizeModerationCollections(
  filteredProjects: ModerationData["projectsResult"],
  filteredOverlays: ModerationData["overlaysResult"],
  filteredChangeRequests: (ModerationData["projectChanges"][number] & { hasConflict: boolean })[],
  reportCounts: Map<string, number>,
) {
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
      ownerReportCount: project.ownerId ? (reportCounts.get(project.ownerId) ?? 0) : 0,
    };
  }
  for (const overlay of filteredOverlays) {
    overlaysById[overlay.id] = {
      ...overlay,
      authorReportCount: overlay.authorId ? (reportCounts.get(overlay.authorId) ?? 0) : 0,
    };
  }

  const changeRequestsWithReports = [];
  for (const change of filteredChangeRequests) {
    const requestedByReportCount = change.requestedBy
      ? (reportCounts.get(change.requestedBy) ?? 0)
      : 0;
    changeRequestsWithReports.push({ ...change, requestedByReportCount });
  }

  return {
    projectsById,
    overlaysById,
    changeRequests: changeRequestsWithReports,
  };
}
