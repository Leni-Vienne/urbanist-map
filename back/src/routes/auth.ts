import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import { TRPCError } from "@trpc/server";
import { globalRateLimiter } from "../lib/rateLimit";
import { getClientIp } from "../utils/ip";
import crypto from "node:crypto";
import { eq, gt } from "drizzle-orm";
import { publicProcedure, loggedInProcedure, router } from "../trpc";
import { db } from "../database";
import { users, projects, overlays, changeRequests } from "../db/schema";
import {
  registerSchema,
  resetPasswordRequestSchema,
  resetPasswordSchema,
} from "../../../shared/validation/schemas";
import { getEmailService } from "../services/emailService";
import { verifyTurnstileToken } from "../utils/captcha";
import { renderEmailTemplate } from "../email/templateRenderer";

// Use shared validation schemas

// Utility functions
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function sendVerificationEmail(
  email: string,
  token: string,
  locale: "en" | "fr" = "en",
): Promise<void> {
  try {
    const emailService = getEmailService();
    const verificationUrl = `${process.env.FRONTEND_URL}/verify?token=${token}`;

    // Use template renderer with i18n support
    const { subject, html } = await renderEmailTemplate(
      "verification",
      { verificationUrl },
      locale,
    );

    await emailService.sendEmail(email, subject, html);
    console.log(`Verification email sent successfully to ${email}`);
  } catch (error) {
    console.error("Failed to send verification email:", error);
    // In development, fallback to console logging
    if (process.env.NODE_ENV === "development") {
      console.log(`[DEV FALLBACK] Verification email to ${email} with token: ${token}`);
      console.log(`Verification link: ${process.env.FRONTEND_URL}/verify?token=${token}`);
    } else {
      throw error;
    }
  }
}

async function sendPasswordResetEmail(
  email: string,
  token: string,
  locale: "en" | "fr" = "en",
): Promise<void> {
  try {
    const emailService = getEmailService();
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    // Use template renderer with i18n support
    const { subject, html } = await renderEmailTemplate("passwordReset", { resetUrl }, locale);

    await emailService.sendEmail(email, subject, html);
    console.log(`Password reset email sent successfully to ${email}`);
  } catch (error) {
    console.error("Failed to send password reset email:", error);
    // In development, fallback to console logging
    if (process.env.NODE_ENV === "development") {
      console.log(`[DEV FALLBACK] Password reset email to ${email} with token: ${token}`);
      console.log(`Reset link: ${process.env.FRONTEND_URL}/reset-password?token=${token}`);
    } else {
      throw error;
    }
  }
}

export const authRouter = router({
  // User registration
  register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
    try {
      const { email, password, username, captchaToken } = input;

      // Rate limit: 5 registrations per IP per hour
      const ip = getClientIp(ctx.hono);
      if (!globalRateLimiter.check(ip, 5, 60 * 60 * 1000)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "auth.error.tooManyRequests",
        });
      }

      // Validate CAPTCHA
      // Optional if key not configured (dev mode), but frontend should send token if configured
      if (process.env.TURNSTILE_SECRET_KEY && captchaToken) {
        const isValidCaptcha = await verifyTurnstileToken(captchaToken, ip);
        if (!isValidCaptcha) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "auth.error.invalidCaptcha",
          });
        }
      }

      // Check if user already exists
      const existingUserResult = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      const existingUser = existingUserResult[0];
      if (existingUser) {
        // If user exists but email is not verified, allow re-registration (overwrite)
        if (!existingUser.emailVerified) {
          // Delete the unverified user
          await db.delete(users).where(eq(users.id, existingUser.id));
        } else {
          // Check if this is an OAuth-only account
          if (existingUser.googleId && !existingUser.passwordHash) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "auth.error.emailUsesGoogleSignIn",
            });
          }

          throw new TRPCError({
            code: "CONFLICT",
            message: "auth.error.registrationFailed", // Obscure existing email (security best practice)
          });
        }
      }

      // Check username uniqueness if provided
      if (username) {
        const existingUsername = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);
        if (existingUsername.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "auth.error.usernameTaken",
          });
        }
      }

      // Hash password with Bun
      const passwordHash = await Bun.password.hash(password);

      // Generate verification token
      const plainVerificationToken = generateToken();
      const emailVerificationToken = await Bun.password.hash(plainVerificationToken);

      // Create user
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          passwordHash,
          username: username ?? email.split("@")[0],
          emailVerificationToken,
          emailVerified: false,
        })
        .returning();

      if (!newUser) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "auth.error.registrationFailed",
        });
      }

      // Send verification email
      await sendVerificationEmail(email, plainVerificationToken);

      return {
        success: true,
        message: "auth.success.registered",
        user: {
          id: newUser.id,
          email: newUser.email,
          username: newUser.username,
          emailVerified: newUser.emailVerified,
        },
      };
    } catch (error) {
      // If the code threw a TRPCError (intentional client/server error), rethrow it
      // So that the specific message (i18n key) is preserved and can be translated on the client.
      if (error instanceof TRPCError) {
        throw error;
      }

      console.error("Registration error:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "auth.error.registrationFailed",
      });
    }
  }),

  // Verify email
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        // Rate limit: 5 verify attempts per IP per hour (brute force protection)
        const ip = getClientIp(ctx.hono);
        if (!globalRateLimiter.check(ip, 5, 60 * 60 * 1000)) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "auth.error.tooManyRequests",
          });
        }

        const { token } = input;

        // Find all users with verification tokens and check each one
        const usersWithTokens = await db.select().from(users).where(eq(users.emailVerified, false));

        let matchedUser = null;
        for (const user of usersWithTokens) {
          if (
            user.emailVerificationToken &&
            (await Bun.password.verify(token, user.emailVerificationToken))
          ) {
            matchedUser = user;
            break;
          }
        }

        if (!matchedUser) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid verification token",
          });
        }

        // Update user as verified
        await db
          .update(users)
          .set({
            emailVerified: true,
            emailVerificationToken: null,
          })
          .where(eq(users.id, matchedUser.id));

        // Create session for auto-login (30-day duration)
        const session = ctx.hono.get("session");
        const sessionDuration = 30 * 24 * 60 * 60; // 30 days in seconds
        const expiresAt = new Date(Date.now() + sessionDuration * 1000);

        session.set("user", {
          id: matchedUser.id,
          email: matchedUser.email,
          username: matchedUser.username,
          role: matchedUser.role,
          moderatedCountries: matchedUser.moderatedCountries,
          emailVerified: true,
        });

        session.set("expiresAt", expiresAt.toISOString());

        // Return user data for frontend to update state
        return {
          success: true,
          message: "Email verified successfully",
          user: {
            id: matchedUser.id,
            email: matchedUser.email,
            username: matchedUser.username,
            role: matchedUser.role,
            moderatedCountries: matchedUser.moderatedCountries,
            emailVerified: true,
          },
        };
      } catch (error) {
        console.error("Email verification error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Email verification failed",
        });
      }
    }),

  // Request password reset
  requestPasswordReset: publicProcedure
    .input(resetPasswordRequestSchema)
    .mutation(({ input, ctx }) => {
      const { email } = input;

      // Rate limit: 5 password reset requests per IP per hour
      const ip = getClientIp(ctx.hono);
      if (!globalRateLimiter.check(ip, 5, 60 * 60 * 1000)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "auth.error.tooManyRequests",
        });
      }

      // SECURITY: Fire and forget - respond immediately to prevent ALL timing attacks
      // Void the promise to indicate intentional fire-and-forget behavior
      // eslint-disable-next-line @eslint/no-void
      void (async () => {
        try {
          // Find user
          const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

          if (!user) {
            // User doesn't exist - silently fail for security
            return;
          }

          // SECURITY: Check if email is verified
          // Prevent password reset bypass for unverified emails
          if (!user.emailVerified) {
            return;
          }

          // SECURITY: Check if OAuth-only user - silently fail (don't reveal auth method)
          if (user.googleId && !user.passwordHash) {
            // OAuth-only users can't reset password - silently fail to prevent enumeration
            return;
          }

          // Generate reset token and expiry (1 hour)
          const plainResetToken = generateToken();
          const resetToken = await Bun.password.hash(plainResetToken);
          const resetExpiry = new Date();
          resetExpiry.setHours(resetExpiry.getHours() + 1);

          // Update user with reset token
          await db
            .update(users)
            .set({
              passwordResetToken: resetToken,
              passwordResetExpiresAt: resetExpiry,
            })
            .where(eq(users.id, user.id));

          // Send password reset email
          await sendPasswordResetEmail(email, plainResetToken);
        } catch (error) {
          // Log error but don't expose it to client
          console.error("Password reset background processing error:", error);
        }
      })();
      // SECURITY: Always return the same response immediately (no timing leak, no info leak)
      return {
        success: true,
        message: "If an account with this email exists, a password reset link has been sent.",
      };
    }),

  // Reset password
  resetPassword: publicProcedure.input(resetPasswordSchema).mutation(async ({ input }) => {
    try {
      const { token, password } = input;

      // Find users with valid reset tokens and check each one
      const usersWithResetTokens = await db
        .select()
        .from(users)
        .where(gt(users.passwordResetExpiresAt, new Date()));

      let matchedUser = null;
      for (const user of usersWithResetTokens) {
        if (
          user.passwordResetToken &&
          (await Bun.password.verify(token, user.passwordResetToken))
        ) {
          matchedUser = user;
          break;
        }
      }

      if (!matchedUser) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired reset token",
        });
      }

      // Hash new password with Bun
      const passwordHash = await Bun.password.hash(password);

      // Update user password and clear reset token
      await db
        .update(users)
        .set({
          passwordHash,
          passwordResetToken: null,
          passwordResetExpiresAt: null,
        })
        .where(eq(users.id, matchedUser.id));

      // Sessions are handled by Hono middleware, no need to invalidate here

      return {
        success: true,
        email: matchedUser.email,
        message: "Password reset successfully. Please log in with your new password.",
      };
    } catch (error) {
      console.error("Password reset error:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Password reset failed",
      });
    }
  }),

  // GDPR Right of Access - Export all user data
  exportMyData: loggedInProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.user.id;

      // Rate limit: 5 data exports per hour per user (prevent abuse)
      const ip = getClientIp(ctx.hono);
      if (!globalRateLimiter.check(`export:${userId}`, 5, 60 * 60 * 1000)) {
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
          googleId: users.googleId,
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

      // Get all user projects (approved, pending, rejected - GDPR requires ALL)
      const userProjects = await db.select().from(projects).where(eq(projects.ownerId, userId));

      // Get all user overlays (approved, pending, rejected - GDPR requires ALL)
      const userOverlays = await db.select().from(overlays).where(eq(overlays.authorId, userId));

      // Get all user change requests
      const userChangeRequests = await db
        .select()
        .from(changeRequests)
        .where(eq(changeRequests.requestedBy, userId));

      // Audit log: Record data export for compliance
      console.log(`[GDPR] Data export requested by user ${userId} (${user.email}) from IP ${ip}`);

      // Return complete data export
      return {
        account: user,
        projects: userProjects,
        overlays: userOverlays,
        changeRequests: userChangeRequests,
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
        if (!globalRateLimiter.check(`delete:${ip}`, 3, 60 * 60 * 1000)) {
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

        // SECURITY: Verify password before allowing deletion (critical safeguard)
        // Prevents session hijacking from deleting accounts
        if (!user.passwordHash) {
          // OAuth-only users (no password) cannot self-delete via API
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Accounts created with OAuth cannot be deleted from this endpoint. Please contact support at contact@urbanistmap.org to request account deletion.",
          });
        }

        const validPassword = await Bun.password.verify(currentPassword, user.passwordHash);
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

        // Session invalidation handled by Hono middleware on logout

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
