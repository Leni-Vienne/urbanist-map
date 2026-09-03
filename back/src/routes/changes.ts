import { moderatorProcedure, loggedInProcedure, router } from "../trpc";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import { GeoJSONGeometryCollectionSchema } from "zod-geojson";
import {
  projects,
  overlays,
  changeRequests,
  changeHistory,
  type EntityType,
  users,
  userReports,
} from "../db/schema";
import { eq, and, inArray, sql, or, isNull, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, type DatabaseExecutor } from "../database";
import { scalarGeometrySizeMSql } from "../db/geometrySize";
import { invalidateProjectTiles, invalidateOverlayTiles } from "./tiles";
import { invalidateLatestContributionsCache } from "./feed";

const approveChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.uuid()),
});

const rejectChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.uuid()),
});

// Helper to validate and parse a GeoJSON GeometryCollection, throwing on invalid input
function parseGeometryCollection(value: unknown): GeoJSON.GeometryCollection {
  const parsed = GeoJSONGeometryCollectionSchema.safeParse(value);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid geometry: must be a valid GeoJSON GeometryCollection",
    });
  }
  return parsed.data;
}

// Helper to check if entity type is supported
function isSupportedEntityType(type: string): type is EntityType {
  return type === "project" || type === "overlay";
}

type Coord = { lat: number; lng: number };

// Type guard for a single coordinate object
function isCoord(obj: unknown): obj is Coord {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "lat" in obj &&
    "lng" in obj &&
    Number.isFinite(obj.lat) &&
    Number.isFinite(obj.lng)
  );
}

// Type guard for an array of exactly 4 coordinates
function isCornersArray(value: unknown): value is [Coord, Coord, Coord, Coord] {
  return Array.isArray(value) && value.length === 4 && value.every(isCoord);
}

// Helper function to convert corners JSON array to PostGIS polygon geometry
function convertCornersToGeometry(cornersValue: unknown) {
  if (!isCornersArray(cornersValue)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Corners must be an array of 4 coordinate objects",
    });
  }

  // Build polygon using parameterized PostGIS functions to prevent SQL injection
  // SECURITY: Do NOT use sql.raw() with string concatenation - it bypasses parameterization
  const [topLeft, topRight, bottomRight, bottomLeft] = cornersValue;
  return sql`ST_SetSRID(ST_MakePolygon(
    ST_MakeLine(ARRAY[
      ST_MakePoint(${topLeft.lng}, ${topLeft.lat}),
      ST_MakePoint(${topRight.lng}, ${topRight.lat}),
      ST_MakePoint(${bottomRight.lng}, ${bottomRight.lat}),
      ST_MakePoint(${bottomLeft.lng}, ${bottomLeft.lat}),
      ST_MakePoint(${topLeft.lng}, ${topLeft.lat})
    ])
  ), 4326)`;
}

function parseCoordinate(coordValue: unknown): Coord {
  if (!isCoord(coordValue)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Coordinate must be an object with lat and lng properties",
    });
  }

  return coordValue;
}

// Helper function to convert coordinate object to PostGIS point geometry
function convertCoordinateToGeometry(coordinate: Coord) {
  return sql`ST_SetSRID(ST_MakePoint(${coordinate.lng}, ${coordinate.lat}), 4326)`;
}

// Project fields backed by timestamp columns. Stored in jsonb as ISO strings,
// so they need coercion back to Date before Drizzle serializes them.
const PROJECT_DATE_FIELDS = new Set(["proposalDate", "startDate", "endDate"]);

// Helper function to build update data with proper geometry handling
function buildUpdateData(change: { entityType: string; fieldName: string; newValue: unknown }) {
  const isOverlayCornersField = change.entityType === "overlay" && change.fieldName === "corners";
  const isOverlayCentroidField = change.entityType === "overlay" && change.fieldName === "centroid";
  const isProjectCenterCoordinateField =
    change.entityType === "project" && change.fieldName === "centerCoordinate";

  if (isOverlayCornersField) {
    return { corners: convertCornersToGeometry(change.newValue) };
  }

  if (isOverlayCentroidField) {
    const coordinate = parseCoordinate(change.newValue);
    return { centroid: convertCoordinateToGeometry(coordinate) };
  }

  if (isProjectCenterCoordinateField) {
    const coordinate = parseCoordinate(change.newValue);
    return {
      centerCoordinate: convertCoordinateToGeometry(coordinate),
      lat: coordinate.lat,
      lng: coordinate.lng,
    };
  }

  const isProjectGeometryField = change.entityType === "project" && change.fieldName === "geometry";
  if (isProjectGeometryField) {
    if (change.newValue === null || change.newValue === undefined) {
      return { geometry: null, geometrySizeM: null };
    }
    const collection = parseGeometryCollection(change.newValue);
    // ST_MakeValid normalizes the client-drawn shape (same as the submission write path) so a
    // self-intersecting or malformed collection is stored valid rather than as-drawn.
    const geometryExpr = sql`ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(collection)}), 4326))`;
    // geometry_size_m is derived from the shape, so it moves with it in the same UPDATE.
    return { geometry: geometryExpr, geometrySizeM: scalarGeometrySizeMSql(geometryExpr) };
  }

  if (change.entityType === "project" && PROJECT_DATE_FIELDS.has(change.fieldName)) {
    const value = change.newValue;
    // oxlint-disable-next-line no-unsafe-type-assertion
    const date = value === null || value === undefined ? null : new Date(value as string | number);
    return { [change.fieldName]: date };
  }

  // For non-geometry fields, use the value directly
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

// Common select fields for change requests with user info
const changeRequestSelectFields = {
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
  requestedByReportCount:
    sql<number>`(SELECT COUNT(DISTINCT ${userReports.reportedBy})::int FROM ${userReports} WHERE ${userReports.reportedUserId} = ${changeRequests.requestedBy})`.as(
      "requestedByReportCount",
    ),
  createdAt: changeRequests.createdAt,
} as const;

export async function getMyChangeRequests(database: DatabaseExecutor, userId: string) {
  const rows = await database
    .select(changeRequestSelectFields)
    .from(changeRequests)
    .leftJoin(users, eq(changeRequests.requestedBy, users.id))
    .where(
      and(
        eq(changeRequests.requestedBy, userId),
        or(eq(changeRequests.status, "pending"), eq(changeRequests.status, "conflicted")),
      ),
    )
    .orderBy(changeRequests.createdAt);

  return rows.map((change) =>
    Object.assign({}, change, { hasConflict: change.status === "conflicted" }),
  );
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

        await db.transaction(async (tx) => {
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

            // Build update data with proper handling for geometry fields
            const updateData = buildUpdateData(change);

            if (change.entityType === "project") {
              await tx.update(projects).set(updateData).where(eq(projects.id, change.entityId));
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
              await tx.update(overlays).set(updateData).where(eq(overlays.id, change.entityId));
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
        });

        const seen = new Set<string>();
        for (const change of changesToApprove) {
          const key = `${change.entityType}:${change.entityId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (change.entityType === "project") {
            await invalidateProjectTiles(change.entityId);
          } else {
            await invalidateOverlayTiles(change.entityId);
          }
        }

        // Always invalidate the latest contributions cache when change requests are approved
        // because it might change the project/overlay details shown in the feed
        if (changesToApprove.length > 0) {
          invalidateLatestContributionsCache();
        }
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
