import { adminProcedure, publicProcedure, router } from '../trpc';
import { z } from 'zod';
import { projects, overlays, changeRequests, changeHistory } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../database';

const submitChangeRequestSchema = z.object({
  entityType: z.enum(['project', 'overlay']),
  entityId: z.string().uuid(),
  changes: z.array(z.object({
    fieldName: z.string(),
    oldValue: z.any().optional(),
    newValue: z.any(),
    changeReason: z.string().optional(),
  })),
});

const approveChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.string().uuid()),
});

const rejectChangeRequestSchema = z.object({
  changeRequestIds: z.array(z.string().uuid()),
});

export const changesRouter = router({
    submitChangeRequest: publicProcedure
      .input(submitChangeRequestSchema)
      .mutation(async ({ input, ctx }) => {
        try {
          const userId = ctx.user?.id;
          if (!userId) {
            throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Must be logged in to submit changes' });
          }

          const changeRequestsToInsert = input.changes.map(change => ({
            entityType: input.entityType,
            entityId: input.entityId,
            fieldName: change.fieldName,
            oldValue: change.oldValue,
            newValue: change.newValue,
            changeReason: change.changeReason,
            requestedBy: userId,
          }));

          await db.insert(changeRequests).values(changeRequestsToInsert);
          
          return { success: true };
        } catch (error) {
          console.error('Error submitting change request:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to submit change request' });
        }
      }),

    getPendingChangeRequests: adminProcedure
      .query(async () => {
        try {
          const pendingChanges = await db
            .select({
              id: changeRequests.id,
              entityType: changeRequests.entityType,
              entityId: changeRequests.entityId,
              fieldName: changeRequests.fieldName,
              oldValue: changeRequests.oldValue,
              newValue: changeRequests.newValue,
              changeReason: changeRequests.changeReason,
              requestedBy: changeRequests.requestedBy,
              createdAt: changeRequests.createdAt,
            })
            .from(changeRequests)
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

          const pendingChanges = await db
            .select()
            .from(changeRequests)
            .where(inArray(changeRequests.id, input.changeRequestIds));

          for (const change of pendingChanges) {
            await db.transaction(async (tx) => {
              const updateData = { [change.fieldName]: change.newValue };
              
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

              await tx.delete(changeRequests).where(eq(changeRequests.id, change.id));
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
      .mutation(async ({ input }) => {
        try {
          if (input.changeRequestIds.length === 0) {
            return { success: true };
          }

          await db.delete(changeRequests).where(inArray(changeRequests.id, input.changeRequestIds));
          
          return { success: true };
        } catch (error) {
          console.error('Error rejecting change requests:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to reject change requests' });
        }
      }),

    getChangeHistory: adminProcedure
      .input(z.object({
        entityType: z.enum(['project', 'overlay']).optional(),
        entityId: z.string().uuid().optional(),
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