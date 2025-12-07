import * as z from "zod"; // smaller bundle compared to 'import { z } from 'zod';
import { TRPCError } from "@trpc/server";
import crypto from "crypto";
import { eq, gt } from "drizzle-orm";
import { publicProcedure, router } from "../trpc";
import { db } from "../database";
import { users } from "../db/schema";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import {
  registerSchema,
  resetPasswordRequestSchema,
  resetPasswordSchema,
} from "../../../shared/validation/schemas";

// AI : Use shared validation schemas

// AI : Utility functions
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// AI : Email placeholder service
// AI : Email service using Amazon SES
interface EmailServiceConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

class EmailService {
  private config: EmailServiceConfig;

  constructor(config: EmailServiceConfig) {
    this.config = config;
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      // AI : Use nodemailer for SMTP connection
      const nodemailer = await import("nodemailer");

      const transportConfig: SMTPTransport.Options = {
        host: this.config.host,
        port: this.config.port,
        secure: process.env.SMTP_SECURE === "true", // Use TLS/SSL
      };

      // AI : Only add auth if credentials are provided (not needed for Mailpit)
      if (this.config.user && this.config.password) {
        transportConfig.auth = {
          user: this.config.user,
          pass: this.config.password,
        };
      }

      const transporter = nodemailer.createTransport(transportConfig);

      const mailOptions = {
        from: this.config.from,
        to: to,
        subject: subject,
        html: html,
      };

      const result = await transporter.sendMail(mailOptions);
      console.log(`Email sent successfully to ${to}:`, result.messageId);
    } catch (error) {
      console.error("Email sending error:", error);

      // AI : In development, fallback to console logging
      if (process.env.NODE_ENV === "development") {
        console.log(`[DEV FALLBACK] Email to ${to}`);
        console.log(`Subject: ${subject}`);
        console.log("SMTP Config:", {
          host: this.config.host,
          port: this.config.port,
          user: this.config.user,
          from: this.config.from,
        });
      } else {
        throw error;
      }
    }
  }
}

// AI : Initialize email service
function getEmailService(): EmailService {
  const config: EmailServiceConfig = {
    // AI : Use Mailpit for development, AWS SES for production
    host:
      process.env.SMTP_HOST ??
      (process.env.SES_REGION
        ? `email-smtp.${process.env.SES_REGION}.amazonaws.com`
        : "email-smtp.us-east-1.amazonaws.com"),
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USERNAME ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.FROM_EMAIL ?? "",
  };

  // AI : For Mailpit (dev), credentials are optional
  if (process.env.NODE_ENV === "development" && config.host === "localhost") {
    // AI : Mailpit doesn't need authentication
    if (!config.from) {
      console.warn("FROM_EMAIL configuration missing");
    }
    // AI : For production (AWS SES), credentials are required
  } else if (!config.user || !config.password || !config.from) {
    console.warn(
      "SMTP configuration incomplete. Required: SMTP_USERNAME, SMTP_PASSWORD, FROM_EMAIL",
    );
  }

  return new EmailService(config);
}

async function sendVerificationEmail(
  email: string,
  token: string,
  locale: "en" | "fr" = "en",
): Promise<void> {
  try {
    const emailService = getEmailService();
    const verificationUrl = `${process.env.FRONTEND_URL}/verify?token=${token}`;

    // AI : Use template renderer with i18n support
    const { renderEmailTemplate } = await import("../email/templateRenderer");
    const { subject, html } = await renderEmailTemplate(
      "verification",
      { verificationUrl },
      locale,
    );

    await emailService.sendEmail(email, subject, html);
    console.log(`Verification email sent successfully to ${email}`);
  } catch (error) {
    console.error("Failed to send verification email:", error);
    // AI : In development, fallback to console logging
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

    // AI : Use template renderer with i18n support
    const { renderEmailTemplate } = await import("../email/templateRenderer");
    const { subject, html } = await renderEmailTemplate("passwordReset", { resetUrl }, locale);

    await emailService.sendEmail(email, subject, html);
    console.log(`Password reset email sent successfully to ${email}`);
  } catch (error) {
    console.error("Failed to send password reset email:", error);
    // AI : In development, fallback to console logging
    if (process.env.NODE_ENV === "development") {
      console.log(`[DEV FALLBACK] Password reset email to ${email} with token: ${token}`);
      console.log(`Reset link: ${process.env.FRONTEND_URL}/reset-password?token=${token}`);
    } else {
      throw error;
    }
  }
}

export const authRouter = router({
  // AI : User registration
  register: publicProcedure.input(registerSchema).mutation(async ({ input }) => {
    try {
      const { email, password, username } = input;

      // AI : Check if user already exists
      const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (existingUser.length > 0) {
        // AI : If user exists but email is not verified, allow re-registration (overwrite)
        if (!existingUser[0].emailVerified) {
          // AI : Delete the unverified user
          await db.delete(users).where(eq(users.id, existingUser[0].id));
        } else {
          // AI : Check if this is an OAuth-only account
          if (existingUser[0].googleId && !existingUser[0].passwordHash) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "auth.error.emailUsesGoogleSignIn",
            });
          }

          throw new TRPCError({
            code: "CONFLICT",
            message: "auth.error.emailAlreadyExists",
          });
        }
      }

      // AI : Check username uniqueness if provided
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

      // AI : Hash password with Bun
      const passwordHash = await Bun.password.hash(password);

      // AI : Generate verification token
      const plainVerificationToken = generateToken();
      const emailVerificationToken = await Bun.password.hash(plainVerificationToken);

      // AI : Create user
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

      // AI : Send verification email
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
      // AI : If the code threw a TRPCError (intentional client/server error), rethrow it
      // so that the specific message (i18n key) is preserved and can be translated on the client.
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

  // AI : Verify email
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const { token } = input;

        // AI : Find all users with verification tokens and check each one
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

        // AI : Update user as verified
        await db
          .update(users)
          .set({
            emailVerified: true,
            emailVerificationToken: null,
          })
          .where(eq(users.id, matchedUser.id));

        return {
          success: true,
          message: "Email verified successfully",
        };
      } catch (error) {
        console.error("Email verification error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Email verification failed",
        });
      }
    }),

  // AI : Request password reset
  requestPasswordReset: publicProcedure.input(resetPasswordRequestSchema).mutation(({ input }) => {
    const { email } = input;

    // AI : SECURITY: Fire and forget - respond immediately to prevent ALL timing attacks
    // AI : Void the promise to indicate intentional fire-and-forget behavior
    void (async () => {
      try {
        // AI : Find user
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

        if (!user) {
          // AI : User doesn't exist - silently fail for security
          return;
        }

        // AI : SECURITY: Check if OAuth-only user - silently fail (don't reveal auth method)
        if (user.googleId && !user.passwordHash) {
          // AI : OAuth-only users can't reset password - silently fail to prevent enumeration
          return;
        }

        // AI : Generate reset token and expiry (1 hour)
        const plainResetToken = generateToken();
        const resetToken = await Bun.password.hash(plainResetToken);
        const resetExpiry = new Date();
        resetExpiry.setHours(resetExpiry.getHours() + 1);

        // AI : Update user with reset token
        await db
          .update(users)
          .set({
            passwordResetToken: resetToken,
            passwordResetExpiresAt: resetExpiry,
          })
          .where(eq(users.id, user.id));

        // AI : Send password reset email
        await sendPasswordResetEmail(email, plainResetToken);
      } catch (error) {
        // AI : Log error but don't expose it to client
        console.error("Password reset background processing error:", error);
      }
    })();
    // AI : SECURITY: Always return the same response immediately (no timing leak, no info leak)
    return {
      success: true,
      message: "If an account with this email exists, a password reset link has been sent.",
    };
  }),

  // AI : Reset password
  resetPassword: publicProcedure.input(resetPasswordSchema).mutation(async ({ input }) => {
    try {
      const { token, password } = input;

      // AI : Find users with valid reset tokens and check each one
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

      // AI : Hash new password with Bun
      const passwordHash = await Bun.password.hash(password);

      // AI : Update user password and clear reset token
      await db
        .update(users)
        .set({
          passwordHash,
          passwordResetToken: null,
          passwordResetExpiresAt: null,
        })
        .where(eq(users.id, matchedUser.id));

      // AI : Sessions are handled by Hono middleware, no need to invalidate here

      return {
        success: true,
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
});
