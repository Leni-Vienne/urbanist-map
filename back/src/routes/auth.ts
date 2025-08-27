import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import crypto from 'crypto';
import { eq, and, gt } from 'drizzle-orm';
import { publicProcedure, router, protectedProcedure } from '../trpc';
import { db } from '../db';
import { users } from '../db/schema';
import { setCookie, deleteCookie } from 'hono/cookie';

// AI : Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: z.string().min(3).max(50).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const resetPasswordRequestSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8),
});

// AI : Utility functions
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// AI : Email placeholder service
async function sendVerificationEmail(email: string, token: string): Promise<void> {
  // AI : Placeholder for email sending
  console.log(`[EMAIL PLACEHOLDER] Verification email to ${email} with token: ${token}`);
  console.log(`Verification link: ${process.env.FRONTEND_URL}/verify?token=${token}`);
}

async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  // AI : Placeholder for email sending
  console.log(`[EMAIL PLACEHOLDER] Password reset email to ${email} with token: ${token}`);
  console.log(`Reset link: ${process.env.FRONTEND_URL}/reset-password?token=${token}`);
}

export const authRouter = router({
  // AI : User registration
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ input }) => {
      try {
        const { email, password, username } = input;

        // AI : Check if user already exists
        const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (existingUser.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'User already exists with this email',
          });
        }

        // AI : Check username uniqueness if provided
        if (username) {
          const existingUsername = await db.select().from(users).where(eq(users.username, username)).limit(1);
          if (existingUsername.length > 0) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Username already taken',
            });
          }
        }

        // AI : Hash password with Bun
        const passwordHash = await Bun.password.hash(password);

        // AI : Generate verification token
        const plainVerificationToken = generateToken();
        const emailVerificationToken = await Bun.password.hash(plainVerificationToken);

        // AI : Create user
        const [newUser] = await db.insert(users).values({
          email,
          passwordHash,
          username: username ?? email.split('@')[0],
          emailVerificationToken,
          emailVerified: false,
        }).returning();

        // AI : Send verification email
        await sendVerificationEmail(email, plainVerificationToken);

        return {
          success: true,
          message: 'User registered successfully. Please check your email to verify your account.',
          user: {
            id: newUser.id,
            email: newUser.email,
            username: newUser.username,
            emailVerified: newUser.emailVerified,
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error('Registration error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Registration failed',
        });
      }
    }),

  // AI : User login
  login: publicProcedure
    .input(loginSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { email, password } = input;

        // AI : Find user
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Invalid email or password',
          });
        }

        // AI : Verify password with Bun
        const isValidPassword = await Bun.password.verify(password, user.passwordHash);
        if (!isValidPassword) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Invalid email or password',
          });
        }

        // AI : Check if email is verified
        if (!user.emailVerified) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Please verify your email before logging in',
          });
        }

        // AI : Set secure cookie with user ID
        if (ctx.hono) {
          setCookie(ctx.hono, 'user_id', user.id, {
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
            maxAge: 60 * 60 * 24 * 30, // AI : 30 days
          });
        }

        return {
          success: true,
          message: 'Logged in successfully',
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            emailVerified: user.emailVerified,
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error('Login error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Login failed',
        });
      }
    }),

  // AI : User logout
  logout: publicProcedure
    .mutation(async ({ ctx }) => {
      try {
        // AI : Clear the user cookie
        if (ctx.hono) {
          deleteCookie(ctx.hono, 'user_id');
        }
        return { success: true, message: 'Logged out successfully' };
      } catch (error) {
        console.error('Logout error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Logout failed',
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
        const usersWithTokens = await db.select().from(users)
          .where(eq(users.emailVerified, false));

        let matchedUser = null;
        for (const user of usersWithTokens) {
          if (user.emailVerificationToken && await Bun.password.verify(token, user.emailVerificationToken)) {
            matchedUser = user;
            break;
          }
        }

        if (!matchedUser) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid verification token',
          });
        }

        // AI : Update user as verified
        await db.update(users)
          .set({
            emailVerified: true,
            emailVerificationToken: null,
          })
          .where(eq(users.id, matchedUser.id));

        return {
          success: true,
          message: 'Email verified successfully',
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error('Email verification error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Email verification failed',
        });
      }
    }),

  // AI : Request password reset
  requestPasswordReset: publicProcedure
    .input(resetPasswordRequestSchema)
    .mutation(async ({ input }) => {
      try {
        const { email } = input;

        // AI : Find user
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) {
          // AI : Don't reveal if user exists or not for security
          return {
            success: true,
            message: 'If an account with this email exists, a password reset link has been sent.',
          };
        }

        // AI : Generate reset token and expiry (1 hour)
        const plainResetToken = generateToken();
        const resetToken = await Bun.password.hash(plainResetToken);
        const resetExpiry = new Date();
        resetExpiry.setHours(resetExpiry.getHours() + 1);

        // AI : Update user with reset token
        await db.update(users)
          .set({
            passwordResetToken: resetToken,
            passwordResetExpiresAt: resetExpiry,
          })
          .where(eq(users.id, user.id));

        // AI : Send password reset email
        await sendPasswordResetEmail(email, plainResetToken);

        return {
          success: true,
          message: 'If an account with this email exists, a password reset link has been sent.',
        };
      } catch (error) {
        console.error('Password reset request error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Password reset request failed',
        });
      }
    }),

  // AI : Reset password
  resetPassword: publicProcedure
    .input(resetPasswordSchema)
    .mutation(async ({ input }) => {
      try {
        const { token, password } = input;

        // AI : Find users with valid reset tokens and check each one
        const usersWithResetTokens = await db.select().from(users)
          .where(gt(users.passwordResetExpiresAt, new Date()));

        let matchedUser = null;
        for (const user of usersWithResetTokens) {
          if (user.passwordResetToken && await Bun.password.verify(token, user.passwordResetToken)) {
            matchedUser = user;
            break;
          }
        }

        if (!matchedUser) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid or expired reset token',
          });
        }

        // AI : Hash new password with Bun
        const passwordHash = await Bun.password.hash(password);

        // AI : Update user password and clear reset token
        await db.update(users)
          .set({
            passwordHash,
            passwordResetToken: null,
            passwordResetExpiresAt: null,
          })
          .where(eq(users.id, matchedUser.id));

        // AI : Sessions are handled by Hono middleware, no need to invalidate here

        return {
          success: true,
          message: 'Password reset successfully. Please log in with your new password.',
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error('Password reset error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Password reset failed',
        });
      }
    }),

  // AI : Get current user
  me: protectedProcedure
    .query(async ({ ctx }) => {
      return {
        user: ctx.user ? {
          id: ctx.user.id,
          email: ctx.user.email,
          username: ctx.user.username,
          role: ctx.user.role,
          emailVerified: ctx.user.emailVerified,
        } : null,
      };
    }),

});