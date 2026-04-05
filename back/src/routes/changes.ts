import { adminProcedure, moderatorProcedure, loggedInProcedure, router } from "../trpc";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import { GeoJSONGeometryCollectionSchema } from "zod-geojson";
import {
  projects,
  overlays,
  changeRequests,
  changeHistory,
  type EntityType,
  users,
  cities,
} from "../db/schema";
import { eq, and, inArray, sql, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../database";
import { addConflictFlags, enrichChangeRequestsWithNames, isUserBlocked } from "../db/helpers";
import { submitChangeRequestSchema } from "@shared/validation/schemas";
import { globalRateLimiter } from "../lib/rateLimit";
import { getClientIp } from "../utils/ip";
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
    typeof (obj as Coord).lat === "number" &&
    typeof (obj as Coord).lng === "number"
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

// Helper function to convert coordinate object to PostGIS point geometry
function convertCoordinateToGeometry(coordValue: unknown) {
  if (!isCoord(coordValue)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Coordinate must be an object with lat and lng properties",
    });
  }

  return sql`ST_SetSRID(ST_MakePoint(${coordValue.lng}, ${coordValue.lat}), 4326)`;
}

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
    return { centroid: convertCoordinateToGeometry(change.newValue) };
  }

  if (isProjectCenterCoordinateField) {
    return { centerCoordinate: convertCoordinateToGeometry(change.newValue) };
  }

  const isProjectGeometryField = change.entityType === "project" && change.fieldName === "geometry";
  if (isProjectGeometryField) {
    if (change.newValue === null || change.newValue === undefined) {
      return { geometry: null };
    }
    const collection = parseGeometryCollection(change.newValue);
    return { geometry: sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(collection)}), 4326)` };
  }

  // For non-geometry fields, use the value directly
  return { [change.fieldName]: change.newValue };
}

// Helper to get country code for an entity (project or overlay)
async function getEntityCountryCode(
  entityType: EntityType,
  entityId: string,
): Promise<string | undefined> {
  // Build query based on entity type - projects join city directly, overlays via projects
  const query =
    entityType === "project"
      ? db
          .select({ countryCode: cities.countryCode })
          .from(projects)
          .innerJoin(cities, eq(projects.cityId, cities.id))
          .where(eq(projects.id, entityId))
      : db
          .select({ countryCode: cities.countryCode })
          .from(overlays)
          .innerJoin(projects, eq(overlays.projectId, projects.id))
          .innerJoin(cities, eq(projects.cityId, cities.id))
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

  // Get country code for the entity
  if (!isSupportedEntityType(entityType)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      message: `Invalid entity type: ${entityType}`,
    });
  }

  // Get country code for the entity
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
  requestedByReportCount: sql<number>`0`.as("requestedByReportCount"),
  createdAt: changeRequests.createdAt,
} as const;

export const changesRouter = router({
  submitChangeRequest: loggedInProcedure
    .input(submitChangeRequestSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;

        // Spam prevention - block banned or heavily reported users
        if (await isUserBlocked(userId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your account has been flagged for review. Please contact support.",
          });
        }

        // Rate limit: 20 change requests per IP per hour
        const ip = getClientIp(ctx.hono);
        if (!globalRateLimiter.check(ip, 20, 60 * 60 * 1000)) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many change requests. Please try again later.",
          });
        }

        // Verify that the entity exists and is approved
        // Users can only submit change requests for approved content
        if (input.entityType === "overlay") {
          const overlayResult = await db
            .select({ status: overlays.status })
            .from(overlays)
            .where(eq(overlays.id, input.entityId))
            .limit(1);

          if (!overlayResult[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Overlay not found",
            });
          }

          if (overlayResult[0].status !== "approved") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Change requests can only be submitted for approved overlays",
            });
          }
        } else if (input.entityType === "project") {
          const projectResult = await db
            .select({ status: projects.status })
            .from(projects)
            .where(eq(projects.id, input.entityId))
            .limit(1);

          if (!projectResult[0]) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Project not found",
            });
          }

          if (projectResult[0].status !== "approved") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Change requests can only be submitted for approved projects",
            });
          }
        }

        // Validate field values before writing to the DB
        for (const change of input.changes) {
          if (input.entityType === "project" && change.fieldName === "geometry") {
            if (change.newValue !== null && change.newValue !== undefined) {
              parseGeometryCollection(change.newValue);
            }
          }
        }

        // Process each change request - replace existing ones for the same field from the same user
        await db.transaction(async (tx) => {
          for (const change of input.changes) {
            // Delete any existing pending/conflicted change request for the same field from the same user
            // This allows users to update their suggestions without creating duplicates
            await tx
              .delete(changeRequests)
              .where(
                and(
                  eq(changeRequests.entityType, input.entityType),
                  eq(changeRequests.entityId, input.entityId),
                  eq(changeRequests.fieldName, change.fieldName),
                  eq(changeRequests.requestedBy, userId),
                  sql`${changeRequests.status} IN ('pending', 'conflicted')`,
                ),
              );

            // Insert the new change request with 'pending' status
            // Multiple users can have pending changes for the same field
            // 'conflicted' status is only set by moderators as a soft rejection when approving a competing change
            await tx.insert(changeRequests).values({
              entityType: input.entityType,
              entityId: input.entityId,
              fieldName: change.fieldName,
              oldValue: change.oldValue,
              newValue: change.newValue,
              changeReason: change.changeReason,
              requestedBy: userId,
              status: "pending",
            });
          }
        });

        return { success: true };
      } catch (error) {
        console.error("Error submitting change request:", error);
        // Log detailed error information for debugging
        if (error instanceof Error) {
          console.error("Error message:", error.message);
          console.error("Error stack:", error.stack);
        }
        console.error("Input data:", JSON.stringify(input, null, 2));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to submit change request",
        });
      }
    }),

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

        // Delete the change request
        await db.delete(changeRequests).where(eq(changeRequests.id, input.id));

        return { success: true };
      } catch (error) {
        console.error("Error deleting change request:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete change request",
        });
      }
    }),

  getMyChangeRequests: loggedInProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.user.id;

      // Only show pending/conflicted change requests (not approved/rejected)
      const myChanges = await db
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

      // Add hasConflict field to maintain type consistency with getPendingChangeRequests
      // For user's own changes, we show conflicts when status is 'conflicted' (another change was chosen)
      const changesWithConflictInfo = myChanges.map((change) => {
        return Object.assign({}, change, {
          hasConflict: change.status === "conflicted",
        });
      });

      // Enrich with city and country names
      const enrichedChanges = await enrichChangeRequestsWithNames(changesWithConflictInfo);

      return enrichedChanges;
    } catch (error) {
      console.error("Error fetching my change requests:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch my change requests",
      });
    }
  }),

  getPendingChangeRequests: moderatorProcedure.query(async ({ ctx }) => {
    try {
      const userModeratedCountries = ctx.user.moderatedCountries;
      const isAdmin = ctx.user.role === "admin";

      // Only show 'pending' changes to moderators
      // 'conflicted' status means "another change was chosen" (soft rejection by moderator)
      const pendingChanges = await db
        .select(changeRequestSelectFields)
        .from(changeRequests)
        .leftJoin(users, eq(changeRequests.requestedBy, users.id))
        .where(eq(changeRequests.status, "pending"))
        .orderBy(changeRequests.createdAt);

      // Filter change requests by moderator's assigned countries
      let filteredChanges = pendingChanges;
      if (!isAdmin && userModeratedCountries && userModeratedCountries.length > 0) {
        // Get country codes for all change requests
        const changeRequestCountries = await Promise.all(
          pendingChanges.map(async (change) => {
            try {
              const countryCode = await getEntityCountryCode(change.entityType, change.entityId);
              return { changeId: change.id, countryCode };
            } catch {
              return { changeId: change.id, countryCode: undefined };
            }
          }),
        );

        // Filter to only changes in moderator's countries
        const allowedChangeIds = new Set(
          changeRequestCountries
            .filter((c) => c.countryCode && userModeratedCountries.includes(c.countryCode))
            .map((c) => c.changeId),
        );

        filteredChanges = pendingChanges.filter((change) => allowedChangeIds.has(change.id));
      }

      // Add hasConflict flag to changes that have competing requests
      const changesWithConflictInfo = addConflictFlags(filteredChanges);

      // Enrich with city and country names
      const enrichedChanges = await enrichChangeRequestsWithNames(changesWithConflictInfo);

      return enrichedChanges;
    } catch (error) {
      console.error("Error fetching pending change requests:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch pending change requests",
      });
    }
  }),

  approveChangeRequests: moderatorProcedure
    .input(approveChangeRequestSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.changeRequestIds.length === 0) {
          return { success: true };
        }

        const moderatorUserId = ctx.user?.id;
        if (!moderatorUserId) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Moderator access required" });
        }

        // Check moderator has permission for all change requests
        for (const changeRequestId of input.changeRequestIds) {
          await checkModeratorChangeRequestPermission(changeRequestId, ctx.user);
        }

        const changesToApprove = await db
          .select()
          .from(changeRequests)
          .where(inArray(changeRequests.id, input.changeRequestIds));

        for (const change of changesToApprove) {
          await db.transaction(async (tx) => {
            // Build update data with proper handling for geometry fields
            const updateData = buildUpdateData(change);

            if (change.entityType === "project") {
              await tx.update(projects).set(updateData).where(eq(projects.id, change.entityId));
            } else if (change.entityType === "overlay") {
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

            // Mark this change as approved instead of deleting
            await tx
              .update(changeRequests)
              .set({
                status: "approved",
                resolvedAt: new Date(),
                resolvedBy: moderatorUserId,
              })
              .where(eq(changeRequests.id, change.id));

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
          });
        }

        const seen = new Set<string>();
        for (const change of changesToApprove) {
          const key = `${change.entityType}:${change.entityId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (change.entityType === "project") {
            await invalidateProjectTiles(change.entityId);
          } else if (change.entityType === "overlay") {
            await invalidateOverlayTiles(change.entityId);
          }
        }

        // Always invalidate the latest contributions cache when change requests are approved
        // because it might change the project/overlay details shown in the feed
        if (changesToApprove.length > 0) {
          invalidateLatestContributionsCache();
        }

        return { success: true };
      } catch (error) {
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
        if (input.changeRequestIds.length === 0) {
          return { success: true };
        }

        const moderatorUserId = ctx.user?.id;
        if (!moderatorUserId) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Moderator access required" });
        }

        // Check moderator has permission for all change requests
        for (const changeRequestId of input.changeRequestIds) {
          await checkModeratorChangeRequestPermission(changeRequestId, ctx.user);
        }

        // Get the requestedBy for each change request to increment their rejection counts
        const changesToReject = await db
          .select({ id: changeRequests.id, requestedBy: changeRequests.requestedBy })
          .from(changeRequests)
          .where(inArray(changeRequests.id, input.changeRequestIds));

        // Use transaction to atomically update status and increment rejection counts
        await db.transaction(async (tx) => {
          // Mark changes as rejected instead of deleting (for audit trail)
          await tx
            .update(changeRequests)
            .set({
              status: "rejected",
              resolvedAt: new Date(),
              resolvedBy: moderatorUserId,
            })
            .where(inArray(changeRequests.id, input.changeRequestIds));

          // Increment rejection count for each requester
          for (const change of changesToReject) {
            if (change.requestedBy) {
              await tx
                .update(users)
                .set({ rejectedCount: sql`${users.rejectedCount} + 1` })
                .where(eq(users.id, change.requestedBy));
            }
          }
        });

        return { success: true };
      } catch (error) {
        console.error("Error rejecting change requests:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to reject change requests",
        });
      }
    }),

  getChangeHistory: adminProcedure
    .input(
      z.object({
        entityType: z.enum(["project", "overlay"]).optional(),
        entityId: z.uuid().optional(),
      }),
    )
    .query(async ({ input }) => {
      try {
        const baseQuery = db.select().from(changeHistory);

        const whereConditions = [];
        if (input.entityType) {
          whereConditions.push(eq(changeHistory.entityType, input.entityType));
        }
        if (input.entityId) {
          whereConditions.push(eq(changeHistory.entityId, input.entityId));
        }

        const query =
          whereConditions.length > 0 ? baseQuery.where(and(...whereConditions)) : baseQuery;

        const history = await query.orderBy(changeHistory.appliedAt);
        return history;
      } catch (error) {
        console.error("Error fetching change history:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch change history",
        });
      }
    }),
});
