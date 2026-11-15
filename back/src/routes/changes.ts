import { moderatorProcedure, loggedInProcedure, router } from "../trpc";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import { projects, overlays, changeRequests, changeHistory, users } from "../db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  CHANGE_REQUEST_FIELDS,
  PROJECT_CHANGE_FIELDS,
  validateProjectPatch,
  type ChangeRequestFieldName,
  type ProjectPatch,
  type OverlayCorners,
} from "@shared/validation/schemas";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { projectValuesEqual } from "@shared/projectValues";
import { PROJECT_COLUMNS, OVERLAY_COLUMNS } from "../db/helpers";
import { db, type Transaction } from "../database";
import {
  overlayGeometryValues,
  parseCoordinate,
  pointSql,
  projectGeometryValues,
} from "../db/geometry";
import { captureProjectMapState } from "../db/projectMapState";
import { reconcileProjectChanges } from "../services/projectEffects";
import { assertModeratorCountry, type ModeratorUser } from "./moderation/shared";

const approveChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.uuid()),
});

const rejectChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.uuid()),
});

// Project fields backed by timestamp columns. Stored in jsonb as ISO strings,
// so they need coercion back to Date before Drizzle serializes them.
const PROJECT_DATE_FIELDS = new Set(["proposalDate", "startDate", "endDate"]);
const changeFieldSchema = z.enum(CHANGE_REQUEST_FIELDS);
type CurrentChangeValues = Partial<
  Record<
    ChangeRequestFieldName,
    ProjectPatch[keyof ProjectPatch] | OverlayCorners | { lat: number; lng: number }
  >
>;

// Geometry writes keep their dependent columns together; legacy coordinate requests still work.
function buildOverlayUpdateData(change: { fieldName: string; newValue: unknown }) {
  if (change.fieldName === "corners") return overlayGeometryValues(change.newValue);
  if (change.fieldName === "centroid") {
    return { centroid: pointSql(parseCoordinate(change.newValue)) };
  }
  if (change.fieldName !== "caption") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid overlay field" });
  }
  return { caption: change.newValue };
}

function buildProjectUpdateData(change: { fieldName: string; newValue: unknown }) {
  if (change.fieldName === "centerCoordinate") {
    const coordinate = parseCoordinate(change.newValue);
    return { centerCoordinate: pointSql(coordinate), lat: coordinate.lat, lng: coordinate.lng };
  }
  if (change.fieldName === "geometry") return projectGeometryValues(change.newValue);
  if (PROJECT_DATE_FIELDS.has(change.fieldName)) {
    const value = change.newValue;
    // oxlint-disable-next-line no-unsafe-type-assertion
    const date = value === null || value === undefined ? null : new Date(value as string | number);
    return { [change.fieldName]: date };
  }
  if (!PROJECT_CHANGE_FIELDS.some((field) => field === change.fieldName)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid project field" });
  }
  return { [change.fieldName]: change.newValue };
}

type PendingChange = Omit<typeof changeRequests.$inferSelect, "fieldName"> & {
  fieldName: ChangeRequestFieldName;
};

async function lockChangeTargets(
  tx: Transaction,
  changes: Pick<typeof changeRequests.$inferSelect, "entityType" | "entityId">[],
  user: ModeratorUser,
) {
  // Lock parents before images and requests, as submission and image approval do.
  const overlayIds = changes.flatMap((c) => (c.entityType === "overlay" ? [c.entityId] : []));
  const parents =
    overlayIds.length > 0
      ? await tx
          .select({ projectId: overlays.projectId })
          .from(overlays)
          .where(inArray(overlays.id, overlayIds))
      : [];
  const projectIds = [
    ...new Set([
      ...changes.flatMap((c) => (c.entityType === "project" ? [c.entityId] : [])),
      ...parents.flatMap((p) => (p.projectId ? [p.projectId] : [])),
    ]),
  ];
  const projectRows =
    projectIds.length > 0
      ? await tx
          .select({
            ...PROJECT_COLUMNS,
            centerCoordinate: sql<{
              lat: number;
              lng: number;
            } | null>`json_build_object('lat', ${projects.lat}, 'lng', ${projects.lng})`,
          })
          .from(projects)
          .where(inArray(projects.id, projectIds))
          .orderBy(projects.id)
          .for("update")
      : [];
  const overlayRows =
    overlayIds.length > 0
      ? await tx
          .select(OVERLAY_COLUMNS)
          .from(overlays)
          .where(inArray(overlays.id, overlayIds))
          .orderBy(overlays.id)
          .for("update")
      : [];
  if (
    user.role !== "admin" &&
    (projectRows.length !== projectIds.length || overlayRows.length !== new Set(overlayIds).size)
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Contribution no longer exists" });
  }
  for (const project of projectRows) {
    assertModeratorCountry(user, project);
  }
  return { projectRows, overlayRows, projectIds, overlayIds };
}

async function applyChangeGroup(
  tx: Transaction,
  group: PendingChange[],
  targets: Awaited<ReturnType<typeof lockChangeTargets>>,
) {
  const { projectRows, overlayRows } = targets;
  const first = group[0];
  if (!first) return;
  const target =
    first.entityType === "project"
      ? projectRows.find((row) => row.id === first.entityId)
      : overlayRows.find((row) => row.id === first.entityId);
  const parentApproved =
    first.entityType === "project" ||
    (target &&
      "projectId" in target &&
      projectRows.some((p) => p.id === target.projectId && p.status === "approved"));
  if (!target || !parentApproved || target.status !== "approved") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Contribution is no longer approved",
    });
  }
  const values: CurrentChangeValues = target;
  if (
    group.some((change) => {
      const current = values[change.fieldName];
      return !projectValuesEqual(
        change.fieldName === "tags" ? (current ?? []) : (current ?? null),
        change.oldValue ?? null,
      );
    })
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "The contribution changed since this suggestion was submitted",
    });
  }
  if (new Set(group.map((c) => c.fieldName)).size !== group.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose only one suggestion for each field",
    });
  }
  const data: PgUpdateSetSource<typeof projects> & PgUpdateSetSource<typeof overlays> = {};
  for (const change of group) {
    Object.assign(
      data,
      first.entityType === "project"
        ? buildProjectUpdateData(change)
        : buildOverlayUpdateData(change),
    );
  }
  let updated;
  if (first.entityType === "project") {
    const project = projectRows.find((p) => p.id === first.entityId);
    if (!project) throw new TRPCError({ code: "CONFLICT", message: "Project no longer exists" });
    const patch = Object.fromEntries(
      group.flatMap((c) =>
        c.fieldName === "centerCoordinate"
          ? []
          : [[c.fieldName, PROJECT_DATE_FIELDS.has(c.fieldName) ? data[c.fieldName] : c.newValue]],
      ),
    );
    if (Object.keys(patch).length > 0) {
      const validation = validateProjectPatch(patch, project);
      if (!validation.success)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: validation.error.issues[0]?.message,
        });
    }
    updated = await tx
      .update(projects)
      .set({
        ...data,
        version: sql`${projects.version} + 1`,
        importLockedAt: sql`CASE WHEN ${projects.importSourceId} IS NOT NULL THEN COALESCE(${projects.importLockedAt}, NOW()) ELSE ${projects.importLockedAt} END`,
      })
      .where(eq(projects.id, first.entityId))
      .returning({ id: projects.id });
  } else {
    updated = await tx
      .update(overlays)
      .set({ ...data, version: sql`${overlays.version} + 1` })
      .where(eq(overlays.id, first.entityId))
      .returning({ id: overlays.id });
  }
  if (updated.length !== 1)
    throw new TRPCError({ code: "CONFLICT", message: "Contribution no longer exists" });
}

export const changesRouter = router({
  deleteChangeRequest: loggedInProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const [deleted] = await db
          .delete(changeRequests)
          .where(
            and(
              eq(changeRequests.id, input.id),
              eq(changeRequests.requestedBy, ctx.user.id),
              inArray(changeRequests.status, ["pending", "conflicted"]),
            ),
          )
          .returning({ id: changeRequests.id });
        if (!deleted) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This suggestion is no longer open or does not belong to you",
          });
        }
      } catch (error) {
        console.error("Error deleting change request:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete change request",
        });
      }
    }),

  approveChangeRequests: moderatorProcedure
    .input(approveChangeRequestSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.changeRequestIds.length === 0) return { projectIds: [], overlayIds: [] };

        const result = await db.transaction(async (tx) => {
          const requestRows = await tx
            .select()
            .from(changeRequests)
            .where(
              and(
                inArray(changeRequests.id, input.changeRequestIds),
                eq(changeRequests.status, "pending"),
              ),
            )
            .orderBy(changeRequests.id);
          const changes = requestRows.map((change) => ({
            ...change,
            fieldName: changeFieldSchema.parse(change.fieldName),
          }));
          if (changes.length !== new Set(input.changeRequestIds).size) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A change request was already resolved",
            });
          }

          const targets = await lockChangeTargets(tx, changes, ctx.user);
          const { projectIds, overlayIds } = targets;
          const groups = new Map<string, typeof changes>();
          for (const change of changes) {
            const key = `${change.entityType}:${change.entityId}`;
            const group = groups.get(key) ?? [];
            group.push(change);
            groups.set(key, group);
          }

          const before = await captureProjectMapState(tx, projectIds);
          for (const group of groups.values()) await applyChangeGroup(tx, group, targets);

          // Claim the same target that was validated above. Relinking may have moved a request
          // while this transaction waited for its former parent; that must roll the batch back.
          for (const change of changes) {
            const [claimed] = await tx
              .update(changeRequests)
              .set({ status: "approved", resolvedAt: new Date(), resolvedBy: ctx.user.id })
              .where(
                and(
                  eq(changeRequests.id, change.id),
                  eq(changeRequests.entityId, change.entityId),
                  eq(changeRequests.status, "pending"),
                ),
              )
              .returning({ id: changeRequests.id });
            if (!claimed)
              throw new TRPCError({
                code: "CONFLICT",
                message: "A change request was moved or already resolved",
              });
            await tx
              .update(changeRequests)
              .set({ status: "conflicted", resolvedAt: new Date(), resolvedBy: ctx.user.id })
              .where(
                and(
                  eq(changeRequests.entityType, change.entityType),
                  eq(changeRequests.entityId, change.entityId),
                  eq(changeRequests.fieldName, change.fieldName),
                  eq(changeRequests.status, "pending"),
                ),
              );
          }
          await tx.insert(changeHistory).values(
            changes.map((change) => ({
              changeRequestId: change.id,
              entityType: change.entityType,
              entityId: change.entityId,
              fieldName: change.fieldName,
              oldValue: change.oldValue,
              newValue: change.newValue,
              changedBy: change.requestedBy,
              approvedBy: ctx.user.id,
            })),
          );
          const counts = new Map<string, number>();
          for (const change of changes) {
            if (change.requestedBy)
              counts.set(change.requestedBy, (counts.get(change.requestedBy) ?? 0) + 1);
          }
          for (const [userId, count] of [...counts].toSorted(([a], [b]) => a.localeCompare(b))) {
            await tx
              .update(users)
              .set({ approvedCount: sql`${users.approvedCount} + ${count}` })
              .where(eq(users.id, userId));
          }
          return { before, projectIds, overlayIds };
        });

        await reconcileProjectChanges(result.before);
        return { projectIds: result.projectIds, overlayIds: result.overlayIds };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error approving change requests:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to approve change requests",
        });
      }
    }),

  rejectChangeRequests: moderatorProcedure
    .input(rejectChangeRequestSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.changeRequestIds.length === 0) return;

        await db.transaction(async (tx) => {
          const pending = await tx
            .select({ entityType: changeRequests.entityType, entityId: changeRequests.entityId })
            .from(changeRequests)
            .where(
              and(
                inArray(changeRequests.id, input.changeRequestIds),
                eq(changeRequests.status, "pending"),
              ),
            );
          await lockChangeTargets(tx, pending, ctx.user);
          // Mark changes as rejected instead of deleting (for audit trail)
          const rejectedChanges = await tx
            .update(changeRequests)
            .set({
              status: "rejected",
              resolvedAt: new Date(),
              resolvedBy: ctx.user.id,
            })
            .where(
              and(
                inArray(changeRequests.id, input.changeRequestIds),
                eq(changeRequests.status, "pending"),
              ),
            )
            .returning({ requestedBy: changeRequests.requestedBy });

          if (rejectedChanges.length !== new Set(input.changeRequestIds).size) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "A change request was already resolved",
            });
          }

          // Increment rejection count for each requester
          for (const change of rejectedChanges) {
            if (change.requestedBy) {
              await tx
                .update(users)
                .set({ rejectedCount: sql`${users.rejectedCount} + 1` })
                .where(eq(users.id, change.requestedBy));
            }
          }
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Error rejecting change requests:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to reject change requests",
        });
      }
    }),
});
