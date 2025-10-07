import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { trpcServer } from '@hono/trpc-server'
import { sessionMiddleware, MemoryStore, Session } from 'hono-sessions'
import * as z from 'zod' // smaller bundle compared to 'import { z } from 'zod'
import { appRouter } from './shared/routers'
import { LocalFileStorage } from './shared/storage'
import type { FileUploadResult, FileUploadError } from './shared/types'
import { config } from './config'
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch'
import type { Context } from 'hono'

// AI : Session data type
type SessionData = {
    user?: {
        id: string;
        email: string;
        username: string | null;
        role: string | null;
        emailVerified: boolean;
    };
}

// AI : Main application setup
const app = new Hono<{
    Variables: {
        session: Session<SessionData>
    }
}>()

const storage = new LocalFileStorage()

app.use('*', cors({
    origin: config.CORS_ORIGIN.split(",") ?? [], // to allow for single env with multiple origins
    credentials: true
}))

// AI : Session middleware with memory store
const store = new MemoryStore()
app.use('*', sessionMiddleware({
    store,
    sessionCookieName: 'session',
    encryptionKey: process.env.JWT_SECRET ?? 'fallback-secret-key-for-dev-at-least-32-chars',
    expireAfterSeconds: 60 * 60, // AI : 1 hour
    cookieOptions: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
        domain: process.env.NODE_ENV === 'production' ? '.constructionmap.org' : undefined,
        path: '/',
    }
}))


// AI : tRPC routes
app.use('/trpc/*', trpcServer({
    router: appRouter,
    createContext(_opts: FetchCreateContextFnOptions, c: Context) {
        const session = c.get('session');
        return {
            user: session.get('user') ?? null,
            session,
            hono: c
        }
    }
}))

// AI : Auth routes using Hono (for session management)
app.post('/api/login', async (c) => {
    try {
        const body = await c.req.json();
        
        // AI : Validate request body with Zod
        const validationResult = loginSchema.safeParse(body);
        if (!validationResult.success) {
            const errorMessage = validationResult.error.issues.map((err: any) => err.message).join(', ');
            return c.json({ error: errorMessage }, 400);
        }
        
        const { email, password } = validationResult.data;

        // AI : Find user (same logic as tRPC route)
        const { db } = await import('./database');
        const { users } = await import('./db/schema');
        const { eq } = await import('drizzle-orm');

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) {
            return c.json({ error: 'auth.error.invalidCredentials' }, 401);
        }

        // AI : Check if user has a password (not an OAuth-only account)
        if (!user.passwordHash) {
            return c.json({ error: 'auth.error.accountUsesGoogleSignIn' }, 401);
        }

        // AI : Verify password
        const isValidPassword = await Bun.password.verify(password, user.passwordHash);
        if (!isValidPassword) {
            return c.json({ error: 'auth.error.invalidCredentials' }, 401);
        }

        // AI : Check if email is verified
        if (!user.emailVerified) {
            return c.json({ error: 'auth.error.emailNotVerified' }, 403);
        }

        // AI : Set session with full user data
        const session = c.get('session');
        session.set('user', {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            emailVerified: user.emailVerified,
        });

        return c.json({
            success: true,
            message: 'auth.success.loggedIn',
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
                emailVerified: user.emailVerified,
            },
        });
    } catch (error) {
        console.error('Login error:', error);
        return c.json({ error: 'auth.error.loginFailed' }, 500);
    }
});

// AI : Google OAuth login endpoint
app.post('/api/google-login', async (c) => {
    try {
        const body = await c.req.json();
        
        // AI : Validate request body with Zod
        const googleLoginSchema = z.object({
            token: z.string().min(1, 'Google token is required'),
        });
        
        const validationResult = googleLoginSchema.safeParse(body);
        if (!validationResult.success) {
            const errorMessage = validationResult.error.issues.map((err: any) => err.message).join(', ');
            return c.json({ error: errorMessage }, 400);
        }
        
        const { token } = validationResult.data;

        // AI : Import Google auth utility
        const { verifyGoogleToken } = await import('./utils/googleAuth');
        const { db } = await import('./database');
        const { users } = await import('./db/schema');
        const { eq } = await import('drizzle-orm');

        // AI : Verify Google token
        const googleUser = await verifyGoogleToken(token);
        if (!googleUser) {
            return c.json({ error: 'auth.error.invalidGoogleToken' }, 401);
        }

        // AI : SECURE: First check by googleId (not email!)
        let [existingUser] = await db.select().from(users).where(eq(users.googleId, googleUser.googleId)).limit(1);

        if (existingUser) {
            // AI : User found by Google ID - this is definitely the same person
            // Update email if it changed on Google's side, but keep username stable
            if (existingUser.email !== googleUser.email) {
                await db.update(users)
                    .set({
                        email: googleUser.email, // AI : Email might have changed on Google
                        emailVerified: true,
                        emailVerificationToken: null,
                    })
                    .where(eq(users.id, existingUser.id));
                
                // AI : Refetch updated user
                [existingUser] = await db.select().from(users).where(eq(users.id, existingUser.id)).limit(1);
            }
        } else {
            // AI : No user found by Google ID - check if email exists with different auth method
            const [emailUser] = await db.select().from(users).where(eq(users.email, googleUser.email)).limit(1);
            
            if (emailUser) {
                // AI : Email exists with password-based account
                if (emailUser.googleId) {
                    // AI : SECURITY: Email already linked to a different Google account - block
                    return c.json({
                        error: 'auth.error.emailLinkedToDifferentGoogle',
                        action: 'account_conflict'
                    }, 409);
                }

                // AI : SECURE AUTO-LINKING: User authenticated via Google OAuth proves they control the email
                // AI : Link Google account to existing email/password account
                await db.update(users)
                    .set({
                        googleId: googleUser.googleId,
                        emailVerified: true,
                        emailVerificationToken: null,
                    })
                    .where(eq(users.id, emailUser.id));

                existingUser = emailUser;
                existingUser.googleId = googleUser.googleId;
                existingUser.emailVerified = true;
            } else {
                // AI : Safe to create new Google OAuth user
                const username = googleUser.name;

                // AI : Check if username is taken and generate unique one if needed
                let finalUsername = username;
                let counter = 1;
                while (true) {
                    const existingUsername = await db.select().from(users).where(eq(users.username, finalUsername)).limit(1);
                    if (existingUsername.length === 0) break;
                    finalUsername = `${username}${counter}`;
                    counter++;
                }

                // AI : Create user with Google ID as primary identifier
                [existingUser] = await db.insert(users).values({
                    email: googleUser.email,
                    username: finalUsername,
                    emailVerified: true,
                    passwordHash: null, // AI : No password for OAuth users
                    googleId: googleUser.googleId, // AI : Secure identifier from Google
                }).returning();
            }
        }

        // AI : Set session with full user data
        const session = c.get('session');
        session.set('user', {
            id: existingUser.id,
            email: existingUser.email,
            username: existingUser.username,
            role: existingUser.role,
            emailVerified: existingUser.emailVerified,
        });

        return c.json({
            success: true,
            message: 'auth.success.googleAuthSuccess',
            user: {
                id: existingUser.id,
                email: existingUser.email,
                username: existingUser.username,
                role: existingUser.role,
                emailVerified: existingUser.emailVerified,
            },
        });
    } catch (error) {
        console.error('Google login error:', error);
        return c.json({ error: 'auth.error.googleAuthFailed' }, 500);
    }
});

app.post('/api/logout', (c) => {
    try {
        const session = c.get('session');
        session.deleteSession();
        return c.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        return c.json({ error: 'Logout failed' }, 500);
    }
});

app.get('/api/check-session', (c) => {
    const session = c.get('session');
    const sessionUser = session.get('user');
    
    return c.json({
        userId: sessionUser?.id,
        isAuthenticated: !!sessionUser,
        user: sessionUser ?? null
    });
});

// AI : File upload endpoint
app.post('/api/upload-image', async (c) => {
    try {
        const body = await c.req.formData()
        const file = body.get('image')

        if (!(file instanceof File)) {
            return c.json({ error: 'No file provided' } as FileUploadError, 400)
        }

        // AI : Validate file with Zod
        const validationResult = imageFileSchema.safeParse({
            size: file.size,
            type: file.type,
            name: file.name
        });
        
        if (!validationResult.success) {
            const errorMessage = validationResult.error.issues.map((err: any) => err.message).join(', ');
            return c.json({ error: errorMessage } as FileUploadError, 400);
        }

        // AI : Extract file extension for filename generation
        function getFileExtension(filename: string | undefined | null): string | null {
            if (!filename || typeof filename !== 'string') {
                return null
            }
            const lastDot = filename.lastIndexOf('.')
            if (lastDot === -1 || lastDot === filename.length - 1) {
                return null
            }
            return filename.slice(lastDot + 1).toLowerCase()
        }
        
        const fileExtension = getFileExtension(file.name)
        
        // AI : Ensure we have a valid extension (this should not fail due to Zod validation)
        if (!fileExtension) {
            return c.json({ error: 'Invalid file extension' } as FileUploadError, 400)
        }
        
        const timestamp = Date.now()
        const randomString = Math.random().toString(36).substring(2, 15)
        const filename = `${timestamp}-${randomString}.${fileExtension}`
        
        const buffer = await file.arrayBuffer()
        await storage.put(filename, buffer)
        
        // AI : Local development uses local URL
        const imageUrl = `/uploads/${filename}`
        
        return c.json({ 
            success: true, 
            filename: filename,
            url: imageUrl
        } as FileUploadResult)
    } catch (error) {
        console.error('Error uploading file:', error)
        return c.json({ error: 'Failed to upload file' } as FileUploadError, 500)
    }
})

// AI : Serve uploaded files - only for local development
app.get('/uploads/*', async (c) => {
    try {
        const filename = c.req.path.replace('/uploads/', '')
        
        // AI : Validate filename parameter with Zod
        const validationResult = filenameParamSchema.safeParse({ filename });
        if (!validationResult.success) {
            const errorMessage = validationResult.error.issues.map((err: any) => err.message).join(', ');
            return c.json({ error: errorMessage }, 400);
        }
        
        const file = await storage.get(validationResult.data.filename)
        
        if (file) {
            return new Response(file.body, {
                headers: {
                    'Content-Type': file.contentType ?? 'application/octet-stream',
                    'Cache-Control': 'public, max-age=31536000, must-revalidate',
                    'ETag': `"${filename}-${Date.now()}"`,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            })
        }
        
        return c.json({ error: 'File not found' }, 404)
    } catch (error) {
        console.error('Error serving file:', error)
        return c.json({ error: 'Failed to serve file' }, 500)
    }
})

// AI : Health check endpoint
app.get('/api/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// AI : Only serve frontend files in development mode
if (process.env.NODE_ENV === "development") {
    // AI : Static file serving for frontend
    app.use('*', serveStatic({ root: './front/dist' }))

    // AI : SPA fallback - serve index.html for client-side routing
    app.notFound(async (c) => {
        try {
            const indexFile = Bun.file('./front/dist/index.html')
            const content = await indexFile.text()
            return c.html(content)
        } catch (error) {
            console.error('Error loading index.html:', error)
            return c.html('<h1>404 Not Found</h1>', 404)
        }
    })
}

// AI : Zod validation schemas
const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1, 'Password is required')
})

const filenameParamSchema = z.object({
    filename: z.string().min(1, 'Filename is required')
})

const imageFileSchema = z.object({
    size: z.number().max(10 * 1024 * 1024, 'File too large. Maximum size is 10MB'),
    type: z.enum(['image/jpeg', 'image/png', 'image/webp'], {
        message: 'Invalid file type. Only JPEG, PNG, and WebP are allowed'
    }),
    name: z.string().optional()
})


export type { AppRouter } from './shared/routers'

export default {
    port: config.PORT,
    fetch: app.fetch
}
