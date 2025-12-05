import { adminProcedure, moderatorProcedure, protectedProcedure, router } from '../trpc';
import * as z from 'zod' // smaller bundle compared to 'import { z } from 'zod';
import { projects, overlays, changeRequests, changeHistory, users, cities } from '../db/schema';
import { eq, and, inArray, sql, or } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../database';
import { addConflictFlags, enrichChangeRequestsWithNames } from '../db/helpers';
import { submitChangeRequestSchema } from '@shared/validation/schemas';

// AI : Use shared change request schema for validation
export type { SubmitChangeRequestInput, FieldChange } from '../lib/types';

const approveChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.uuid()),
});

const rejectChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.uuid()),
});

// AI : Helper function to convert corners JSON array to PostGIS polygon geometry
function convertCornersToGeometry(cornersValue: unknown) {
  const cornersArray = cornersValue as { lat: number; lng: number }[];
  if (!Array.isArray(cornersArray) || cornersArray.length !== 4) {
    throw new TRPCError({ 
      code: 'BAD_REQUEST', 
      message: 'Corners must be an array of 4 coordinate objects' 
    });
  }
  
  // AI : Build WKT polygon string (same format as overlay publish)
  const [topLeft, topRight, bottomRight, bottomLeft] = cornersArray;
  const polygonWKT = `POLYGON((${topLeft.lng} ${topLeft.lat}, ${topRight.lng} ${topRight.lat}, ${bottomRight.lng} ${bottomRight.lat}, ${bottomLeft.lng} ${bottomLeft.lat}, ${topLeft.lng} ${topLeft.lat}))`;
  
  return sql.raw(`ST_GeomFromText('${polygonWKT}', 4326)`);
}

// AI : Helper function to convert coordinate object to PostGIS point geometry
function convertCoordinateToGeometry(coordValue: unknown) {
  const coordObj = coordValue as { lat: number; lng: number };
  if (!coordObj || typeof coordObj.lat !== 'number' || typeof coordObj.lng !== 'number') {
    throw new TRPCError({ 
      code: 'BAD_REQUEST', 
      message: 'Coordinate must be an object with lat and lng properties' 
    });
  }
  
  return sql`ST_SetSRID(ST_MakePoint(${coordObj.lng}, ${coordObj.lat}), 4326)`;
}

// AI : Helper function to build update data with proper geometry handling
function buildUpdateData(change: { entityType: string; fieldName: string; newValue: unknown }) {
  const isOverlayCornersField = change.entityType === 'overlay' && change.fieldName === 'corners';
  const isOverlayCentroidField = change.entityType === 'overlay' && change.fieldName === 'centroid';
  const isProjectCenterCoordinateField = change.entityType === 'project' && change.fieldName === 'centerCoordinate';

  if (isOverlayCornersField) {
    return { corners: convertCornersToGeometry(change.newValue) };
  }

  if (isOverlayCentroidField) {
    return { centroid: convertCoordinateToGeometry(change.newValue) };
  }

  if (isProjectCenterCoordinateField) {
    return { centerCoordinate: convertCoordinateToGeometry(change.newValue) };
  }

  // AI : For non-geometry fields, use the value directly
  return { [change.fieldName]: change.newValue };
}

// AI : Helper to get country code for an entity (project or overlay)
async function getEntityCountryCode(
  entityType: 'project' | 'overlay',
  entityId: string
): Promise<string | undefined> {
  // AI : Build query based on entity type - projects join city directly, overlays via projects
  const query = entityType === 'project'
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

// AI : Helper to check if moderator has permission for a change request's country
async function checkModeratorChangeRequestPermission(
  changeRequestId: string,
  user: { role: string | null; moderatedCountries: string[] | null },
): Promise<string> {
  // AI : Admins can moderate any country
  if (user.role === "admin" || user.moderatedCountries === null) {
    return "*";
  }

  // AI : Get the change request and its entity's country code
  const changeRequest = await db
    .select({
      entityType: changeRequests.entityType,
      entityId: changeRequests.entityId,
    })
    .from(changeRequests)
    .where(eq(changeRequests.id, changeRequestId))
    .limit(1);

  if (changeRequest.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Change request not found" });
  }

  const { entityType, entityId } = changeRequest[0];

  // AI : Get country code for the entity
  const countryCode = await getEntityCountryCode(entityType as 'project' | 'overlay', entityId);

  if (!countryCode) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });
  }

  // AI : Check if moderator has permission for this country
  if (!user.moderatedCountries.includes(countryCode)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to moderate content in this country",
    });
  }

  return countryCode;
}

// AI : Common select fields for change requests with user info
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
  requestedByReportCount: sql<number>`0`.as('requestedByReportCount'),
  createdAt: changeRequests.createdAt,
} as const;

export const changesRouter = router({
  submitChangeRequest: protectedProcedure
    .input(submitChangeRequestSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user?.id;
        if (!userId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Must be logged in to submit changes' });
        }

        // AI : Process each change request - replace existing ones for the same field from the same user
        await db.transaction(async (tx) => {
          for (const change of input.changes) {
            // AI : Delete any existing pending/conflicted change request for the same field from the same user
            // AI : This allows users to update their suggestions without creating duplicates
            await tx
              .delete(changeRequests)
              .where(
                and(
                  eq(changeRequests.entityType, input.entityType),
                  eq(changeRequests.entityId, input.entityId),
                  eq(changeRequests.fieldName, change.fieldName),
                  eq(changeRequests.requestedBy, userId),
                  sql`${changeRequests.status} IN ('pending', 'conflicted')`
                )
              );

            // AI : Insert the new change request with 'pending' status
            // AI : Multiple users can have pending changes for the same field
            // AI : 'conflicted' status is only set by moderators as a soft rejection when approving a competing change
            await tx.insert(changeRequests).values({
              entityType: input.entityType,
              entityId: input.entityId,
              fieldName: change.fieldName,
              oldValue: change.oldValue,
              newValue: change.newValue,
              changeReason: change.changeReason,
              requestedBy: userId,
              status: 'pending',
            });
          }
        });

        return { success: true };
      } catch (error) {
        console.error('Error submitting change request:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to submit change request' });
      }
    }),

  deleteChangeRequest: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user?.id;
        if (!userId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Must be logged in to delete change request' });
        }

        // AI : Get change request to check permissions and status
        const changeRequest = await db
          .select({
            id: changeRequests.id,
            requestedBy: changeRequests.requestedBy,
            status: changeRequests.status,
          })
          .from(changeRequests)
          .where(eq(changeRequests.id, input.id))
          .limit(1);

        if (changeRequest.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Change request not found' });
        }

        // AI : Only the requester can delete their own change request
        if (changeRequest[0].requestedBy !== userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to delete this change request' });
        }

        // AI : Only pending and conflicted change requests can be deleted
        if (changeRequest[0].status !== 'pending' && changeRequest[0].status !== 'conflicted') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Can only delete pending or conflicted change requests'
          });
        }

        // AI : Delete the change request
        await db.delete(changeRequests).where(eq(changeRequests.id, input.id));

        return { success: true };
      } catch (error) {
        console.error('Error deleting change request:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete change request' });
      }
    }),

  getMyChangeRequests: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const userId = ctx.user?.id;
        if (!userId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Must be logged in to view change requests' });
        }

        // AI : Only show pending/conflicted change requests (not approved/rejected)
        const myChanges = await db
          .select(changeRequestSelectFields)
          .from(changeRequests)
          .leftJoin(users, eq(changeRequests.requestedBy, users.id))
          .where(
            and(
              eq(changeRequests.requestedBy, userId),
              or(
                eq(changeRequests.status, 'pending'),
                eq(changeRequests.status, 'conflicted')
              )
            )
          )
          .orderBy(changeRequests.createdAt);

        // AI : Add hasConflict field to maintain type consistency with getPendingChangeRequests
        // AI : For user's own changes, we show conflicts when status is 'conflicted' (another change was chosen)
        const changesWithConflictInfo = myChanges.map(change => {
          return Object.assign({}, change, {
            hasConflict: change.status === 'conflicted'
          });
        });

        // AI : Enrich with city and country names
        const enrichedChanges = await enrichChangeRequestsWithNames(changesWithConflictInfo);

        return enrichedChanges;
      } catch (error) {
        console.error('Error fetching my change requests:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch my change requests' });
      }
    }),

  getPendingChangeRequests: moderatorProcedure
    .query(async ({ ctx }) => {
      try {
        const userModeratedCountries = ctx.user.moderatedCountries;
        const isAdmin = ctx.user.role === "admin";

        // AI : Only show 'pending' changes to moderators
        // AI : 'conflicted' status means "another change was chosen" (soft rejection by moderator)
        const pendingChanges = await db
          .select(changeRequestSelectFields)
          .from(changeRequests)
          .leftJoin(users, eq(changeRequests.requestedBy, users.id))
          .where(eq(changeRequests.status, 'pending'))
          .orderBy(changeRequests.createdAt);

        // AI : Filter change requests by moderator's assigned countries
        let filteredChanges = pendingChanges;
        if (!isAdmin && userModeratedCountries && userModeratedCountries.length > 0) {
          // AI : Get country codes for all change requests
          const changeRequestCountries = await Promise.all(
            pendingChanges.map(async (change) => {
              try {
                const countryCode = await getEntityCountryCode(
                  change.entityType as 'project' | 'overlay',
                  change.entityId
                );
                return { changeId: change.id, countryCode };
              } catch {
                return { changeId: change.id, countryCode: undefined };
              }
            })
          );

          // AI : Filter to only changes in moderator's countries
          const allowedChangeIds = new Set(
            changeRequestCountries
              .filter((c) => c.countryCode && userModeratedCountries.includes(c.countryCode))
              .map((c) => c.changeId)
          );

          filteredChanges = pendingChanges.filter((change) => allowedChangeIds.has(change.id));
        }

        // AI : Add hasConflict flag to changes that have competing requests
        const changesWithConflictInfo = addConflictFlags(filteredChanges);

        // AI : Enrich with city and country names
        const enrichedChanges = await enrichChangeRequestsWithNames(changesWithConflictInfo);

        return enrichedChanges;
      } catch (error) {
        console.error('Error fetching pending change requests:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch pending change requests' });
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
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Moderator access required' });
        }

        // AI : Check moderator has permission for all change requests
        for (const changeRequestId of input.changeRequestIds) {
          await checkModeratorChangeRequestPermission(changeRequestId, ctx.user);
        }

        const changesToApprove = await db
          .select()
          .from(changeRequests)
          .where(inArray(changeRequests.id, input.changeRequestIds));

        for (const change of changesToApprove) {
          await db.transaction(async (tx) => {
            // AI : Build update data with proper handling for geometry fields
            const updateData = buildUpdateData(change);

            if (change.entityType === 'project') {
              await tx
                .update(projects)
                .set(updateData)
                .where(eq(projects.id, change.entityId));
            } else if (change.entityType === 'overlay') {
              await tx
                .update(overlays)
                .set(updateData)
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

            // AI : Mark this change as approved instead of deleting
            await tx
              .update(changeRequests)
              .set({
                status: 'approved',
                resolvedAt: new Date(),
                resolvedBy: moderatorUserId,
              })
              .where(eq(changeRequests.id, change.id));

            // AI : Increment the requester's approved count
            if (change.requestedBy) {
              await tx
                .update(users)
                .set({ approvedCount: sql`${users.approvedCount} + 1` })
                .where(eq(users.id, change.requestedBy));
            }

            // AI : Mark all other pending changes for the same field as 'conflicted' (soft rejection)
            // AI : This tells users their suggestion wasn't chosen, not that it was invalid
            // AI : Note: 'conflicted' does NOT count as rejection (user's suggestion was valid, just not chosen)
            await tx
              .update(changeRequests)
              .set({
                status: 'conflicted',
                resolvedAt: new Date(),
                resolvedBy: moderatorUserId,
              })
              .where(
                and(
                  eq(changeRequests.entityType, change.entityType),
                  eq(changeRequests.entityId, change.entityId),
                  eq(changeRequests.fieldName, change.fieldName),
                  sql`${changeRequests.id} != ${change.id}`,
                  eq(changeRequests.status, 'pending')
                )
              );
          });
        }

        return { success: true };
      } catch (error) {
        console.error('Error approving change requests:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to approve change requests' });
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
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Moderator access required' });
        }

        // AI : Check moderator has permission for all change requests
        for (const changeRequestId of input.changeRequestIds) {
          await checkModeratorChangeRequestPermission(changeRequestId, ctx.user);
        }

        // AI : Get the requestedBy for each change request to increment their rejection counts
        const changesToReject = await db
          .select({ id: changeRequests.id, requestedBy: changeRequests.requestedBy })
          .from(changeRequests)
          .where(inArray(changeRequests.id, input.changeRequestIds));

        // AI : Use transaction to atomically update status and increment rejection counts
        await db.transaction(async (tx) => {
          // AI : Mark changes as rejected instead of deleting (for audit trail)
          await tx
            .update(changeRequests)
            .set({
              status: 'rejected',
              resolvedAt: new Date(),
              resolvedBy: moderatorUserId,
            })
            .where(inArray(changeRequests.id, input.changeRequestIds));

          // AI : Increment rejection count for each requester
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
        console.error('Error rejecting change requests:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to reject change requests' });
      }
    }),

  getChangeHistory: adminProcedure
    .input(z.object({
      entityType: z.enum(['project', 'overlay']).optional(),
      entityId: z.uuid().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const baseQuery = db.select().from(changeHistory);

        let whereConditions = [];
        if (input.entityType) {
          whereConditions.push(eq(changeHistory.entityType, input.entityType));
        }
        if (input.entityId) {
          whereConditions.push(eq(changeHistory.entityId, input.entityId));
        }

        const query = whereConditions.length > 0
          ? baseQuery.where(and(...whereConditions))
          : baseQuery;

        const history = await query.orderBy(changeHistory.appliedAt);
        return history;
      } catch (error) {
        console.error('Error fetching change history:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch change history' });
      }
    }),
});
