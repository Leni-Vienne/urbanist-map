import { adminProcedure, protectedProcedure, router } from '../trpc';
import * as z from 'zod' // smaller bundle compared to 'import { z } from 'zod';
import { projects, overlays, changeRequests, changeHistory } from '../db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../database';

const submitChangeRequestSchema = z.object({
  entityType: z.enum(['project', 'overlay']),
  entityId: z.uuid(),
  changes: z.array(z.object({
    fieldName: z.string(),
    oldValue: z.json().optional(),
    newValue: z.json(),
    changeReason: z.string().optional(),
  })),
});

// AI : Export types for frontend usage
export type SubmitChangeRequestInput = z.infer<typeof submitChangeRequestSchema>;
export type FieldChange = SubmitChangeRequestInput['changes'][0];

const approveChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.uuid()),
});

const rejectChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.uuid()),
});

// AI : Helper function to convert corners JSON array to PostGIS polygon geometry
function convertCornersToGeometry(cornersValue: unknown) {
  const cornersArray = cornersValue as Array<{ lat: number; lng: number }>;
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
  const isProjectCoordinatesField = change.entityType === 'project' && change.fieldName === 'coordinates';
  
  if (isOverlayCornersField) {
    return { corners: convertCornersToGeometry(change.newValue) };
  }
  
  if (isOverlayCentroidField) {
    return { centroid: convertCoordinateToGeometry(change.newValue) };
  }
  
  if (isProjectCoordinatesField) {
    return { coordinates: convertCoordinateToGeometry(change.newValue) };
  }
  
  // AI : For non-geometry fields, use the value directly
  return { [change.fieldName]: change.newValue };
}

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
  getMyChangeRequests: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const userId = ctx.user?.id;
        if (!userId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Must be logged in to view change requests' });
        }

        const myChanges = await db
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
            createdAt: changeRequests.createdAt,
          })
          .from(changeRequests)
          .where(eq(changeRequests.requestedBy, userId))
          .orderBy(changeRequests.createdAt);

        return myChanges;
      } catch (error) {
        console.error('Error fetching my change requests:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch my change requests' });
      }
    }),

  getPendingChangeRequests: adminProcedure
    .query(async () => {
      try {
        // AI : Only show 'pending' changes to moderators
        // AI : 'conflicted' status means "another change was chosen" (soft rejection by moderator)
        const pendingChanges = await db
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
            createdAt: changeRequests.createdAt,
          })
          .from(changeRequests)
          .where(eq(changeRequests.status, 'pending'))
          .orderBy(changeRequests.createdAt);

        return pendingChanges;
      } catch (error) {
        console.error('Error fetching pending change requests:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch pending change requests' });
      }
    }),

  approveChangeRequests: adminProcedure
    .input(approveChangeRequestSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.changeRequestIds.length === 0) {
          return { success: true };
        }

        const adminUserId = ctx.user?.id;
        if (!adminUserId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Admin access required' });
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
              approvedBy: adminUserId,
            });

            // AI : Mark this change as approved instead of deleting
            await tx
              .update(changeRequests)
              .set({
                status: 'approved',
                resolvedAt: new Date(),
                resolvedBy: adminUserId,
              })
              .where(eq(changeRequests.id, change.id));

            // AI : Mark all other pending changes for the same field as 'conflicted' (soft rejection)
            // AI : This tells users their suggestion wasn't chosen, not that it was invalid
            await tx
              .update(changeRequests)
              .set({
                status: 'conflicted',
                resolvedAt: new Date(),
                resolvedBy: adminUserId,
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

  rejectChangeRequests: adminProcedure
    .input(rejectChangeRequestSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.changeRequestIds.length === 0) {
          return { success: true };
        }

        const adminUserId = ctx.user?.id;
        if (!adminUserId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Admin access required' });
        }

        // AI : Mark changes as rejected instead of deleting (for audit trail)
        await db
          .update(changeRequests)
          .set({
            status: 'rejected',
            resolvedAt: new Date(),
            resolvedBy: adminUserId,
          })
          .where(inArray(changeRequests.id, input.changeRequestIds));

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
