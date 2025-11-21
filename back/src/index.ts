import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { trpcServer } from '@hono/trpc-server'
import { sessionMiddleware, Session } from 'hono-sessions'
import * as z from 'zod' // smaller bundle compared to 'import { z } from 'zod'
import { appRouter } from './routes'
import { LocalFileStorage, getThumbnailFilename } from './lib/storage'
import type { FileUploadResult, FileUploadError } from './lib/types'
import { config } from './config'
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch'
import type { Context } from 'hono'
import { generateMissingThumbnails } from './lib/startup'
import { DrizzleSessionStore } from './lib/drizzleSessionStore'

// AI : Session data type
type SessionData = {
    user?: {
        id: string;
        email: string;
        username: string | null;
        role: string | null;
        moderatedCountries: string[] | null; // AI : Array of country codes for moderators
        emailVerified: boolean;
    };
    expiresAt?: string;
}

// AI : Main application setup
const app = new Hono<{
    Variables: {
        session: Session<SessionData>
    }
}>()

// AI : Always use local storage for initial uploads - images migrate to R2 on approval
const storage = new LocalFileStorage()

const allowedDomains = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map(d => d.trim())
    .filter(Boolean)


app.use('*', cors({
    origin: (origin) => {
        if (!origin) return null

        if(process.env.NODE_ENV !== 'production') {
            return origin // Allow all origins in development
        }

        // Allow if matches any root domain or subdomain, usefull for checking older cloudflare deployments
        const isAllowed = allowedDomains.some(domain =>
            origin === `https://${domain}` || origin.endsWith(`.${domain}`)
        )

        return isAllowed ? origin : null
    },
    credentials: true
}))

// AI : Database-backed session store using Drizzle ORM for persistence across server restarts
const store = new DrizzleSessionStore()

// AI : Session duration constants
const SESSION_DURATION_SHORT = 7 * 24 * 60 * 60 // AI : 7 days for regular login
const SESSION_DURATION_LONG = 30 * 24 * 60 * 60 // AI : 30 days for "Remember Me"

app.use('*', sessionMiddleware({
    store,
    sessionCookieName: 'session',
    encryptionKey: process.env.JWT_SECRET ?? 'fallback-secret-key-for-dev-at-least-32-chars',
    expireAfterSeconds: SESSION_DURATION_LONG, // AI : Max duration, actual duration set per login
    cookieOptions: {
        httpOnly: true,
        // AI : secure must be true when sameSite is 'None' for cross-site cookies
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
        // AI : No domain restriction to allow the cookie to work with the backend domain
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

        const { email, password, rememberMe } = validationResult.data;

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

        // AI : Calculate session expiry based on Remember Me preference
        const sessionDuration = rememberMe ? SESSION_DURATION_LONG : SESSION_DURATION_SHORT;
        const expiresAt = new Date(Date.now() + sessionDuration * 1000);

        session.set('user', {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            moderatedCountries: user.moderatedCountries,
            emailVerified: user.emailVerified,
        });

        // AI : Set custom session expiry
        session.set('expiresAt', expiresAt.toISOString());

        return c.json({
            success: true,
            message: 'auth.success.loggedIn',
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
                moderatedCountries: user.moderatedCountries,
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
            rememberMe: z.boolean().optional().default(false)
        });

        const validationResult = googleLoginSchema.safeParse(body);
        if (!validationResult.success) {
            const errorMessage = validationResult.error.issues.map((err: any) => err.message).join(', ');
            return c.json({ error: errorMessage }, 400);
        }

        const { token, rememberMe } = validationResult.data;

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

        // AI : Calculate session expiry based on Remember Me preference
        const sessionDuration = rememberMe ? SESSION_DURATION_LONG : SESSION_DURATION_SHORT;
        const expiresAt = new Date(Date.now() + sessionDuration * 1000);

        session.set('user', {
            id: existingUser.id,
            email: existingUser.email,
            username: existingUser.username,
            role: existingUser.role,
            moderatedCountries: existingUser.moderatedCountries,
            emailVerified: existingUser.emailVerified,
        });

        // AI : Set custom session expiry
        session.set('expiresAt', expiresAt.toISOString());

        return c.json({
            success: true,
            message: 'auth.success.googleAuthSuccess',
            user: {
                id: existingUser.id,
                email: existingUser.email,
                username: existingUser.username,
                role: existingUser.role,
                moderatedCountries: existingUser.moderatedCountries,
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

app.get('/api/check-session', async (c) => {
    try {
        const session = c.get('session');
        const sessionUser = session.get('user');

        // AI : Fetch config for info message (if exists)
        const { db } = await import('./database');
        const { config } = await import('./db/schema');
        const { eq } = await import('drizzle-orm');

        const [appConfig] = await db.select().from(config).where(eq(config.id, 1)).limit(1);

        return c.json({
            userId: sessionUser?.id,
            isAuthenticated: !!sessionUser,
            user: sessionUser ?? null,
            infoMessage: appConfig?.infoMessage ?? null
        });
    } catch (error) {
        console.error('Error fetching session:', error);
        // AI : Return session info even if config fetch fails
        const session = c.get('session');
        const sessionUser = session.get('user');
        return c.json({
            userId: sessionUser?.id,
            isAuthenticated: !!sessionUser,
            user: sessionUser ?? null,
            infoMessage: null
        });
    }
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
        // AI : Save to local storage - images are not uploaded to R2 until moderator approval
        // AI : LocalFileStorage.put also automatically generates 120x120 thumbnail
        await storage.put(filename, buffer)

        // AI : Always return local URL - images stay in local storage until approved
        const imageUrl = `/uploads/${filename}`
        const thumbnailUrl = `/uploads/${getThumbnailFilename(filename)}`

        return c.json({
            success: true,
            filename: filename,
            url: imageUrl,
            thumbnailUrl: thumbnailUrl
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
    password: z.string().min(1, 'Password is required'),
    rememberMe: z.boolean().optional().default(false)
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

// AI : Generate missing thumbnails on startup
// This runs asynchronously and doesn't block server startup
generateMissingThumbnails().catch(error => {
    console.error('Failed to generate missing thumbnails:', error);
});

export type { AppRouter } from './routes'

export default {
    port: config.PORT,
    //hostname: '0.0.0.0', //useful for testing on another device in dev, but breaks healthcheck in prod
    fetch: app.fetch
}
