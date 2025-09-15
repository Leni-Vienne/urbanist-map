import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { trpcServer } from '@hono/trpc-server'
import { sessionMiddleware, MemoryStore, Session } from 'hono-sessions'
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

console.log("cors : ", config.CORS_ORIGIN.split(",") ?? [])

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
        console.log("🍪 Cookie header:", c.req.header('cookie'));
        console.log("📊 Session data:", session.get('user'));
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
        const { email, password } = body;

        if (!email || !password) {
            return c.json({ error: 'Email and password required' }, 400);
        }

        // AI : Find user (same logic as tRPC route)
        const { db } = await import('./database');
        const { users } = await import('./db/schema');
        const { eq } = await import('drizzle-orm');

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) {
            return c.json({ error: 'Invalid email or password' }, 401);
        }

        // AI : Verify password
        const isValidPassword = await Bun.password.verify(password, user.passwordHash);
        if (!isValidPassword) {
            return c.json({ error: 'Invalid email or password' }, 401);
        }

        // AI : Check if email is verified
        if (!user.emailVerified) {
            return c.json({ error: 'Please verify your email before logging in' }, 403);
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
            message: 'Logged in successfully',
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
        return c.json({ error: 'Login failed' }, 500);
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

        const maxFileSize = 10 * 1024 * 1024
        if (file.size > maxFileSize) {
            return c.json({ error: 'File too large. Maximum size is 10MB' } as FileUploadError, 400)
        }

        // AI : Better file type validation with MIME type and extension checking
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp']
        const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp']
        
        // AI : Extract file extension in a case-insensitive way
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
        
        // AI : Validate both MIME type and file extension
        if (!allowedMimeTypes.includes(file.type) || !fileExtension || !allowedExtensions.includes(fileExtension)) {
            return c.json({ error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed' } as FileUploadError, 400)
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
        const file = await storage.get(filename)
        
        if (file) {
            return new Response(file.body, {
                headers: {
                    'Content-Type': file.contentType ?? 'application/octet-stream',
                    'Cache-Control': 'public, max-age=31536000'
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

export type { AppRouter } from './shared/routers'

export default {
    port: config.PORT,
    fetch: app.fetch
}
