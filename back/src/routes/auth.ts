import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import crypto from 'crypto';
import { eq, gt } from 'drizzle-orm';
import { publicProcedure, router, protectedProcedure } from '../trpc';
import { db } from '../database';
import { users } from '../db/schema';
import { setCookie, deleteCookie } from 'hono/cookie';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

// AI : Validation schemas
const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  username: z.string().min(7).max(50),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string(),
});

const resetPasswordRequestSchema = z.object({
  email: z.email(),
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
      const nodemailer = await import('nodemailer');
      
      const transportConfig: SMTPTransport.Options = {
        host: this.config.host,
        port: this.config.port,
        secure: process.env.SMTP_SECURE === 'true', // Use TLS/SSL
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
      console.error('Email sending error:', error);
      
      // AI : In development, fallback to console logging
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEV FALLBACK] Email to ${to}`);
        console.log(`Subject: ${subject}`);
        console.log('SMTP Config:', {
          host: this.config.host,
          port: this.config.port,
          user: this.config.user,
          from: this.config.from
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
    host: process.env.SMTP_HOST ?? (process.env.SES_REGION ? `email-smtp.${process.env.SES_REGION}.amazonaws.com` : 'email-smtp.us-east-1.amazonaws.com'),
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USERNAME ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.FROM_EMAIL ?? '',
  };

  // AI : For Mailpit (dev), credentials are optional
  if (process.env.NODE_ENV === 'development' && config.host === 'localhost') {
    // AI : Mailpit doesn't need authentication
    if (!config.from) {
      console.warn('FROM_EMAIL configuration missing');
    }
  } else {
    // AI : For production (AWS SES), credentials are required
    if (!config.user || !config.password || !config.from) {
      console.warn('SMTP configuration incomplete. Required: SMTP_USERNAME, SMTP_PASSWORD, FROM_EMAIL');
    }
  }

  return new EmailService(config);
}

async function sendVerificationEmail(email: string, token: string): Promise<void> {
  try {
    const emailService = getEmailService();
    const verificationUrl = `${process.env.FRONTEND_URL}/verify?token=${token}`;
    
    const subject = 'Verify your email address - Construction Map';
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Email Verification</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
            <h1 style="color: #2c3e50; margin-bottom: 20px;">Welcome to Construction Map!</h1>
            <p style="color: #555; font-size: 16px; line-height: 1.5;">
              Thank you for signing up. To activate your account, please click the link below:
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" 
                 style="background-color: #3498db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Verify my email
              </a>
            </div>
            <p style="color: #777; font-size: 14px;">
              If the button doesn't work, copy and paste this link in your browser:
              <br><a href="${verificationUrl}" style="color: #3498db;">${verificationUrl}</a>
            </p>
            <p style="color: #777; font-size: 12px; margin-top: 30px;">
              This link will expire in 24 hours. If you didn't request this verification, please ignore this email.
            </p>
          </div>
        </body>
      </html>
    `;

    await emailService.sendEmail(email, subject, html);
    console.log(`Verification email sent successfully to ${email}`);
  } catch (error) {
    console.error('Failed to send verification email:', error);
    // AI : In development, fallback to console logging
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV FALLBACK] Verification email to ${email} with token: ${token}`);
      console.log(`Verification link: ${process.env.FRONTEND_URL}/verify?token=${token}`);
    } else {
      throw error;
    }
  }
}

async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  try {
    const emailService = getEmailService();
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    
    const subject = 'Reset your password - Construction Map';
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Password Reset</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
            <h1 style="color: #e74c3c; margin-bottom: 20px;">Password Reset</h1>
            <p style="color: #555; font-size: 16px; line-height: 1.5;">
              You requested a password reset. Click the link below to create a new password:
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #e74c3c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Reset my password
              </a>
            </div>
            <p style="color: #777; font-size: 14px;">
              If the button doesn't work, copy and paste this link in your browser:
              <br><a href="${resetUrl}" style="color: #e74c3c;">${resetUrl}</a>
            </p>
            <p style="color: #777; font-size: 12px; margin-top: 30px;">
              This link will expire in 1 hour. If you didn't request this reset, please ignore this email.
            </p>
          </div>
        </body>
      </html>
    `;

    await emailService.sendEmail(email, subject, html);
    console.log(`Password reset email sent successfully to ${email}`);
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    // AI : In development, fallback to console logging
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV FALLBACK] Password reset email to ${email} with token: ${token}`);
      console.log(`Reset link: ${process.env.FRONTEND_URL}/reset-password?token=${token}`);
    } else {
      throw error;
    }
  }
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
          // AI : If user exists but email is not verified, allow re-registration (overwrite)
          if (!existingUser[0].emailVerified) {
            // AI : Delete the unverified user
            await db.delete(users).where(eq(users.id, existingUser[0].id));
          } else {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'User already exists with this email',
            });
          }
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
            secure: process.env.NODE_ENV === 'production', // AI : Only secure in production (HTTPS)
            sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax', // AI : None for cross-domain in prod, Lax for dev
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
    .mutation(({ ctx }) => {
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
    .query(({ ctx }) => {
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

});;
