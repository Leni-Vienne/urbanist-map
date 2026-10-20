import { moderatorProcedure, loggedInProcedure, router } from "../trpc";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import {
  projects,
  overlays,
  changeRequests,
  changeHistory,
  type EntityType,
  users,
} from "../db/schema";
import { eq, and, inArray, sql, isNull, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../database";
import {
  overlayGeometryValues,
  parseCoordinate,
  pointSql,
  projectGeometryValues,
} from "../db/geometry";
import { captureProjectMapState } from "../db/projectMapState";
import { reconcileProjectChanges } from "../services/projectEffects";

const approveChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.uuid()),
});

const rejectChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.uuid()),
});

// Helper to check if entity type is supported
function isSupportedEntityType(type: string): type is EntityType {
  return type === "project" || type === "overlay";
}

// Project fields backed by timestamp columns. Stored in jsonb as ISO strings,
// so they need coercion back to Date before Drizzle serializes them.
const PROJECT_DATE_FIELDS = new Set(["proposalDate", "startDate", "endDate"]);

// Geometry writes keep their dependent columns together; legacy coordinate requests still work.
function buildOverlayUpdateData(change: { fieldName: string; newValue: unknown }) {
  if (change.fieldName === "corners") return overlayGeometryValues(change.newValue);
  if (change.fieldName === "centroid") {
    return { centroid: pointSql(parseCoordinate(change.newValue)) };
  }
  return { [change.fieldName]: change.newValue };
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
  return { [change.fieldName]: change.newValue };
}

// Helper to get country code for an entity (project or overlay)
async function getEntityCountryCode(
  entityType: EntityType,
  entityId: string,
): Promise<string | undefined> {
  const query =
    entityType === "project"
      ? db
          .select({ countryCode: projects.countryCode })
          .from(projects)
          .where(eq(projects.id, entityId))
      : db
          .select({ countryCode: projects.countryCode })
          .from(overlays)
          .innerJoin(projects, eq(overlays.projectId, projects.id))
          .where(eq(overlays.id, entityId));

  const result = await query.limit(1);
  return result[0]?.countryCode;
}

// Helper to check if moderator has permission for a change request's country
async function checkModeratorChangeRequestPermission(
  changeRequestId: string,
  user: { role: string | null; moderatedCountries: string[] | null },
): Promise<string> {
  // Admins can moderate any country
  if (user.role === "admin") {
    return "*";
  }

  // Get the change request and its entity's country code
  const changeRequest = await db
    .select({
      entityType: changeRequests.entityType,
      entityId: changeRequests.entityId,
    })
    .from(changeRequests)
    .where(eq(changeRequests.id, changeRequestId))
    .limit(1);

  const request = changeRequest[0];
  if (!request) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Change request not found" });
  }

  const { entityType, entityId } = request;

  if (!isSupportedEntityType(entityType)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      // oxlint-disable-next-line restrict-template-expressions
      message: `Invalid entity type: ${entityType}`,
    });
  }

  const countryCode = await getEntityCountryCode(entityType, entityId);

  if (!countryCode) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });
  }

  // Check if moderator has permission for this country
  if (!user.moderatedCountries?.includes(countryCode)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to moderate content in this country",
    });
  }

  return countryCode;
}

// Shared guard for the approve/reject batch mutations: verify the moderator may moderate every
// change request in the batch. Returns the moderator user id.
async function authorizeChangeRequestBatch(
  changeRequestIds: string[],
  user: { id: string; role: string | null; moderatedCountries: string[] | null },
): Promise<string> {
  for (const changeRequestId of changeRequestIds) {
    await checkModeratorChangeRequestPermission(changeRequestId, user);
  }

  return user.id;
}

export const changesRouter = router({
  deleteChangeRequest: loggedInProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;

        // Get change request to check permissions and status
        const changeRequestResult = await db
          .select({
            id: changeRequests.id,
            requestedBy: changeRequests.requestedBy,
            status: changeRequests.status,
          })
          .from(changeRequests)
          .where(eq(changeRequests.id, input.id))
          .limit(1);

        const changeRequest = changeRequestResult[0];
        if (!changeRequest) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Change request not found" });
        }

        // Only the requester can delete their own change request
        if (changeRequest.requestedBy !== userId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to delete this change request",
          });
        }

        // Only pending and conflicted change requests can be deleted
        if (changeRequest.status !== "pending" && changeRequest.status !== "conflicted") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Can only delete pending or conflicted change requests",
          });
        }

        await db.delete(changeRequests).where(eq(changeRequests.id, input.id));
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
        if (input.changeRequestIds.length === 0) return;

        const moderatorUserId = await authorizeChangeRequestBatch(input.changeRequestIds, ctx.user);

        const changesToApprove = await db
          .select()
          .from(changeRequests)
          .where(
            and(
              inArray(changeRequests.id, input.changeRequestIds),
              eq(changeRequests.status, "pending"),
            ),
          );

        if (changesToApprove.length !== new Set(input.changeRequestIds).size) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A change request was already resolved",
          });
        }

        const before = await db.transaction(async (tx) => {
          const projectIds: string[] = [];
          const overlayIds: string[] = [];
          for (const change of changesToApprove) {
            if (change.entityType === "project") projectIds.push(change.entityId);
            else overlayIds.push(change.entityId);
          }
          if (overlayIds.length > 0) {
            const parents = await tx
              .select({ projectId: overlays.projectId })
              .from(overlays)
              .where(inArray(overlays.id, overlayIds));
            for (const parent of parents) {
              if (parent.projectId) projectIds.push(parent.projectId);
            }
          }
          const state = await captureProjectMapState(tx, projectIds);
          for (const change of changesToApprove) {
            const claimedRequests = await tx
              .update(changeRequests)
              .set({
                status: "approved",
                resolvedAt: new Date(),
                resolvedBy: moderatorUserId,
              })
              .where(and(eq(changeRequests.id, change.id), eq(changeRequests.status, "pending")))
              .returning({ id: changeRequests.id });

            if (!claimedRequests[0]) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "A change request was already resolved",
              });
            }

            if (change.entityType === "project") {
              await tx
                .update(projects)
                .set(buildProjectUpdateData(change))
                .where(eq(projects.id, change.entityId));
              // Lock imported projects so the next OSM sync can't overwrite this approved edit.
              await tx
                .update(projects)
                .set({ importLockedAt: new Date() })
                .where(
                  and(
                    eq(projects.id, change.entityId),
                    isNotNull(projects.importSourceId),
                    isNull(projects.importLockedAt),
                  ),
                );
            } else {
              await tx
                .update(overlays)
                .set(buildOverlayUpdateData(change))
                .where(eq(overlays.id, change.entityId));
            }

            await tx.insert(changeHistory).values({
              changeRequestId: change.id,
              entityType: change.entityType,
              entityId: change.entityId,
              fieldName: change.fieldName,
              oldValue: change.oldValue,
              newValue: change.newValue,
              changedBy: change.requestedBy,
              approvedBy: moderatorUserId,
            });

            // Increment the requester's approved count
            if (change.requestedBy) {
              await tx
                .update(users)
                .set({ approvedCount: sql`${users.approvedCount} + 1` })
                .where(eq(users.id, change.requestedBy));
            }

            // Mark all other pending changes for the same field as 'conflicted' (soft rejection)
            // This tells users their suggestion wasn't chosen, not that it was invalid
            // Note: 'conflicted' does NOT count as rejection (user's suggestion was valid, just not chosen)
            await tx
              .update(changeRequests)
              .set({
                status: "conflicted",
                resolvedAt: new Date(),
                resolvedBy: moderatorUserId,
              })
              .where(
                and(
                  eq(changeRequests.entityType, change.entityType),
                  eq(changeRequests.entityId, change.entityId),
                  eq(changeRequests.fieldName, change.fieldName),
                  sql`${changeRequests.id} != ${change.id}`,
                  eq(changeRequests.status, "pending"),
                ),
              );
          }
          return state;
        });

        await reconcileProjectChanges(before);
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

        const moderatorUserId = await authorizeChangeRequestBatch(input.changeRequestIds, ctx.user);

        // Use transaction to atomically update status and increment rejection counts
        await db.transaction(async (tx) => {
          // Mark changes as rejected instead of deleting (for audit trail)
          const rejectedChanges = await tx
            .update(changeRequests)
            .set({
              status: "rejected",
              resolvedAt: new Date(),
              resolvedBy: moderatorUserId,
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
