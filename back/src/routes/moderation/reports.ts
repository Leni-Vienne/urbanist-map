import { moderatorProcedure, adminProcedure } from "../../trpc";
import { db } from "../../database";
import { projects, overlays, users, userReports } from "../../db/schema";
import { and, eq, or, sql, inArray } from "drizzle-orm";
import { deleteImages, deleteLocalImages } from "../../lib/imageCleanup";
import { deleteUserSessions } from "../../lib/drizzleSessionStore";
import { assignProjectBoundary } from "../../db/boundaryAssignment";
import { TRPCError } from "@trpc/server";
import * as z from "zod";

export const reportProcedures = {
  reportUser: moderatorProcedure
    .input(
      z.object({
        userId: z.uuid(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const moderatorId = ctx.user.id;

        const existingReport = await db
          .select({ id: userReports.id })
          .from(userReports)
          .where(
            and(
              eq(userReports.reportedUserId, input.userId),
              eq(userReports.reportedBy, moderatorId),
            ),
          )
          .limit(1);

        if (existingReport.length > 0) {
          return { success: true, alreadyReported: true };
        }

        await db.insert(userReports).values({
          reportedUserId: input.userId,
          reportedBy: moderatorId,
          reason: input.reason,
        });

        const reportCount = await db
          .select({ count: sql<string>`COUNT(*)` })
          .from(userReports)
          .where(eq(userReports.reportedUserId, input.userId));

        return {
          success: true,
          alreadyReported: false,
          totalReports: Number(reportCount[0]?.count ?? 1),
        };
      } catch (error) {
        console.error("Error reporting user:", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to report user" });
      }
    }),

  getReportedUsers: adminProcedure.query(async () => {
    try {
      const configResult = await db
        .select({ reportThreshold: sql<number>`coalesce(report_threshold, 2)` })
        .from(sql`config`)
        .limit(1);

      const threshold = configResult[0]?.reportThreshold ?? 2;

      const reportedUsers = await db
        .select({
          userId: userReports.reportedUserId,
          email: users.email,
          username: users.username,
          banned: users.banned,
          bannedAt: users.bannedAt,
          banReason: users.banReason,
          reportCount: sql<number>`count(distinct ${userReports.reportedBy})::int`,
        })
        .from(userReports)
        .leftJoin(users, eq(userReports.reportedUserId, users.id))
        .groupBy(
          userReports.reportedUserId,
          users.email,
          users.username,
          users.banned,
          users.bannedAt,
          users.banReason,
        )
        .having(sql`count(distinct ${userReports.reportedBy}) >= ${threshold}`);

      const reportedUserIds = reportedUsers.map((u) => u.userId);
      if (reportedUserIds.length === 0) {
        return [];
      }

      // Fetch reporter details and content counts for every reported user in three
      // grouped queries, then stitch them together in memory (avoids N+1).
      const [allReports, projectCounts, overlayCounts] = await Promise.all([
        db
          .select({
            reportedUserId: userReports.reportedUserId,
            reporterId: userReports.reportedBy,
            reporterUsername: users.username,
            reporterEmail: users.email,
            reason: userReports.reason,
            createdAt: userReports.createdAt,
          })
          .from(userReports)
          .leftJoin(users, eq(userReports.reportedBy, users.id))
          .where(inArray(userReports.reportedUserId, reportedUserIds)),
        db
          .select({
            ownerId: projects.ownerId,
            pending: sql<number>`count(case when status = 'pending' then 1 end)::int`,
            rejected: sql<number>`count(case when status = 'rejected' then 1 end)::int`,
          })
          .from(projects)
          .where(inArray(projects.ownerId, reportedUserIds))
          .groupBy(projects.ownerId),
        db
          .select({
            authorId: overlays.authorId,
            pending: sql<number>`count(case when status = 'pending' then 1 end)::int`,
            rejected: sql<number>`count(case when status = 'rejected' then 1 end)::int`,
          })
          .from(overlays)
          .where(inArray(overlays.authorId, reportedUserIds))
          .groupBy(overlays.authorId),
      ]);

      const reportsByUser = new Map<string, typeof allReports>();
      for (const report of allReports) {
        const list = reportsByUser.get(report.reportedUserId) ?? [];
        list.push(report);
        reportsByUser.set(report.reportedUserId, list);
      }

      const projectCountByUser = new Map(projectCounts.map((p) => [p.ownerId, p]));
      const overlayCountByUser = new Map(overlayCounts.map((o) => [o.authorId, o]));

      const enrichedUsers = reportedUsers.map((user) => {
        const reports = (reportsByUser.get(user.userId) ?? []).map((report) => ({
          reporterId: report.reporterId,
          reporterUsername: report.reporterUsername,
          reporterEmail: report.reporterEmail,
          reason: report.reason,
          createdAt: report.createdAt,
        }));
        const projectCount = projectCountByUser.get(user.userId);
        const overlayCount = overlayCountByUser.get(user.userId);

        return {
          userId: user.userId,
          email: user.email,
          username: user.username,
          banned: user.banned,
          bannedAt: user.bannedAt,
          banReason: user.banReason,
          reportCount: user.reportCount,
          reports,
          pendingProjects: projectCount?.pending ?? 0,
          rejectedProjects: projectCount?.rejected ?? 0,
          pendingOverlays: overlayCount?.pending ?? 0,
          rejectedOverlays: overlayCount?.rejected ?? 0,
        };
      });

      return enrichedUsers;
    } catch (error) {
      console.error("Error fetching reported users:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch reported users",
      });
    }
  }),

  clearUserReports: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      try {
        await db.delete(userReports).where(eq(userReports.reportedUserId, input.userId));
        return { success: true };
      } catch (error) {
        console.error("Error clearing user reports:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to clear user reports",
        });
      }
    }),

  banUser: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        reason: z.string().min(1).max(500),
        deleteContent: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({
              banned: true,
              bannedAt: new Date(),
              bannedBy: ctx.user.id,
              banReason: input.reason,
            })
            .where(eq(users.id, input.userId));

          if (input.deleteContent) {
            const overlaysToDelete = await tx
              .select({ filename: overlays.filename })
              .from(overlays)
              .where(
                and(
                  eq(overlays.authorId, input.userId),
                  or(eq(overlays.status, "pending"), eq(overlays.status, "rejected")),
                ),
              );

            await tx
              .delete(projects)
              .where(
                and(
                  eq(projects.ownerId, input.userId),
                  or(eq(projects.status, "pending"), eq(projects.status, "rejected")),
                ),
              );

            await tx
              .delete(overlays)
              .where(
                and(
                  eq(overlays.authorId, input.userId),
                  or(eq(overlays.status, "pending"), eq(overlays.status, "rejected")),
                ),
              );

            for (const overlay of overlaysToDelete) {
              try {
                await deleteLocalImages(overlay.filename, "both");
              } catch (error) {
                console.error(`Failed to delete images for ${overlay.filename}:`, error);
              }
            }
          }

          await tx.delete(userReports).where(eq(userReports.reportedUserId, input.userId));
        });

        await deleteUserSessions(input.userId);

        return { success: true };
      } catch (error) {
        console.error("Error banning user:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to ban user",
        });
      }
    }),

  adminDeleteOverlay: adminProcedure
    .input(
      z.object({
        id: z.uuid(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const overlayData = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            status: overlays.status,
            authorId: overlays.authorId,
            projectId: overlays.projectId,
            kind: overlays.kind,
          })
          .from(overlays)
          .where(eq(overlays.id, input.id))
          .limit(1);

        const overlay = overlayData[0];
        if (!overlay) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Overlay not found" });
        }

        await db.transaction(async (tx) => {
          // Sever replacement-chain pointers first so no sibling row is left referencing
          // the deleted overlay (these columns have no FK to cascade the cleanup).
          await tx
            .update(overlays)
            .set({ replacesOverlayId: null })
            .where(eq(overlays.replacesOverlayId, input.id));
          await tx
            .update(overlays)
            .set({ replacedByOverlayId: null })
            .where(eq(overlays.replacedByOverlayId, input.id));
          await tx.delete(overlays).where(eq(overlays.id, input.id));
        });

        console.log(
          `Admin ${ctx.user.id} deleted overlay ${input.id} (status: ${overlay.status})${input.reason ? ` - Reason: ${input.reason}` : ""}`,
        );

        // Removing an approved map overlay shrinks the project's footprint, so re-derive its
        // boundary. Only approved map overlays ever counted toward it. Best-effort, post-commit.
        if (overlay.kind === "map" && overlay.status === "approved" && overlay.projectId) {
          await assignProjectBoundary(overlay.projectId);
        }

        try {
          await deleteImages(overlay.filename, "both");
        } catch (error) {
          console.error(`Failed to delete images for overlay ${input.id}:`, error);
        }

        return {
          success: true,
          deletedOverlayId: input.id,
          deletedFilename: overlay.filename,
        };
      } catch (error) {
        console.error("Error deleting overlay:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete overlay",
        });
      }
    }),
};
