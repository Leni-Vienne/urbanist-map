import * as z from "zod";
import { and, eq, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as rateLimit from "../lib/rateLimit";
import { getClientIp } from "../utils/ip";
import { loggedInProcedure, router } from "../trpc";
import { db } from "../database";
import { users, projects, overlays, changeRequests, oauthAccounts } from "../db/schema";

export const accountRouter = router({
  // GDPR Right of Access - Export all user data
  exportMyData: loggedInProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.user.id;

      // Rate limit: 5 data exports per hour per user (prevent abuse)
      const ip = getClientIp(ctx.hono);
      if (!rateLimit.check(`export:${userId}`, 5, 60 * 60 * 1000)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many data export requests. Please try again later.",
        });
      }

      // Get user account data (exclude sensitive fields)
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          role: users.role,
          emailVerified: users.emailVerified,
          approvedCount: users.approvedCount,
          rejectedCount: users.rejectedCount,
          banned: users.banned,
          bannedAt: users.bannedAt,
          banReason: users.banReason,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // GDPR requires ALL statuses (approved, pending, rejected). Independent queries, fan out.
      const [userProjects, userOverlays, userChangeRequests, userOAuthAccounts] = await Promise.all(
        [
          db.select().from(projects).where(eq(projects.ownerId, userId)),
          db.select().from(overlays).where(eq(overlays.authorId, userId)),
          db.select().from(changeRequests).where(eq(changeRequests.requestedBy, userId)),
          db
            .select({
              provider: oauthAccounts.provider,
              providerAccountId: oauthAccounts.providerAccountId,
              createdAt: oauthAccounts.createdAt,
            })
            .from(oauthAccounts)
            .where(and(eq(oauthAccounts.userId, userId), ne(oauthAccounts.provider, "credential"))),
        ],
      );

      // Audit log: Record data export for compliance
      console.log(`[GDPR] Data export requested by user ${userId} (${user.email}) from IP ${ip}`);

      // Return complete data export
      return {
        account: user,
        projects: userProjects,
        overlays: userOverlays,
        changeRequests: userChangeRequests,
        oauthAccounts: userOAuthAccounts,
        exportedAt: new Date(),
      };
    } catch (error) {
      console.error("Data export error:", error);
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to export data",
      });
    }
  }),

  // GDPR Right to Erasure - Delete account and anonymize contributions
  deleteAccount: loggedInProcedure
    .input(
      z.object({
        confirmEmail: z.email(),
        currentPassword: z.string().min(8),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;
        const { confirmEmail, currentPassword } = input;

        // Rate limit: 3 deletion attempts per hour per IP (prevent brute force)
        const ip = getClientIp(ctx.hono);
        if (!rateLimit.check(`delete:${ip}`, 3, 60 * 60 * 1000)) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many deletion attempts. Please try again later.",
          });
        }

        // Get user to verify email confirmation
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        // Verify email confirmation matches
        if (user.email !== confirmEmail) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Email confirmation does not match",
          });
        }

        const [credential] = await db
          .select({ password: oauthAccounts.password })
          .from(oauthAccounts)
          .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, "credential")));
        if (!credential?.password) {
          // OAuth-only users (no password) cannot self-delete via API
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Accounts created with OAuth cannot be deleted from this endpoint. Please contact support at contact@urbanistmap.org to request account deletion.`,
          });
        }

        const validPassword = await Bun.password.verify(currentPassword, credential.password);
        if (!validPassword) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid password. Account deletion cancelled.",
          });
        }

        // Audit log: Record account deletion for compliance and forensics
        console.log(
          `[GDPR] Account deletion initiated by user ${userId} (${user.email}) from IP ${ip}`,
        );

        // Use transaction to ensure atomic operation
        await db.transaction(async (tx) => {
          // Anonymize user contributions (set ownerId/authorId/requestedBy to NULL)
          // This preserves public contributions while removing personal data linkage
          await tx.update(projects).set({ ownerId: null }).where(eq(projects.ownerId, userId));

          await tx.update(overlays).set({ authorId: null }).where(eq(overlays.authorId, userId));

          await tx
            .update(changeRequests)
            .set({ requestedBy: null })
            .where(eq(changeRequests.requestedBy, userId));

          // Delete user account (removes all personal data)
          await tx.delete(users).where(eq(users.id, userId));
        });

        // Account and session foreign keys cascade with the deleted user.

        // Audit log: Confirm successful deletion
        console.log(`[GDPR] Account ${userId} (${user.email}) successfully deleted`);

        return {
          success: true,
          message: "Account deleted successfully. All personal data has been removed.",
        };
      } catch (error) {
        console.error("Account deletion error:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete account",
        });
      }
    }),
});
