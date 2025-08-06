import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Session, sessionMiddleware, CookieStore } from 'hono-sessions'
import { trpcServer } from '@hono/trpc-server'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from "postgres"
import * as schema from './db/schema'
import { createAppRouter } from './shared/routers'
import { LocalFileStorage, R2Storage } from './shared/storage'
import type { SessionData, FileUploadResult, FileUploadError } from './shared/types'

interface AppOptions {
    corsOrigin: string | string[]
    sessionEncryptionKey: string
    databaseUrl: string
    r2Bucket?: R2Bucket
    r2PublicUrl?: string
    isProduction?: boolean
}

// AI : Create database connection with appropriate settings
function createDatabase(databaseUrl: string, isProduction = false) {
    const client = postgres(databaseUrl, {
        max: isProduction ? 5 : 10,
        fetch_types: false,
    })
    return drizzle(client, { schema })
}

// AI : Create unified Hono app for both bun and wrangler
export function createApp(options: AppOptions) {
    const app = new Hono<{
        Variables: {
            session: Session<SessionData>
        }
    }>()

    const store = new CookieStore()
    const db = createDatabase(options.databaseUrl, options.isProduction)
    const storage = options.r2Bucket 
        ? new R2Storage(options.r2Bucket)
        : new LocalFileStorage()

    // AI : CORS for local development
    app.use('*', cors({
        origin: options.corsOrigin,
        credentials: true
    }))

    // AI : Session middleware
    app.use('*', sessionMiddleware({
        store,
        sessionCookieName: 'session',
        encryptionKey: options.sessionEncryptionKey,
        expireAfterSeconds: 900,
    }) as any)

    // AI : tRPC routes
    const appRouter = createAppRouter(db)
    app.use('/trpc/*', trpcServer({
        router: appRouter,
        createContext(_opts: any, c: any) {
            return {
                session: c.get('session')
            }
        }
    }))

    // AI : File upload endpoint
    app.post('/api/upload-image', async (c) => {
        try {
            const body = await c.req.formData()
            const file = body.get('image') as File

            if (!file) {
                return c.json({ error: 'No file provided' } as FileUploadError, 400)
            }

            const maxFileSize = 10 * 1024 * 1024
            if (file.size > maxFileSize) {
                return c.json({ error: 'File too large. Maximum size is 10MB' } as FileUploadError, 400)
            }

            const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
            if (!allowedTypes.includes(file.type)) {
                return c.json({ error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed' } as FileUploadError, 400)
            }
            
            const timestamp = Date.now()
            const randomString = Math.random().toString(36).substring(2, 15)
            const fileExtension = file.name.split('.').pop() ?? 'webp'
            const filename = `${timestamp}-${randomString}.${fileExtension}`
            
            const buffer = await file.arrayBuffer()
            await storage.put(filename, buffer)
            
            // AI : Use direct R2 URL in production, local URL for development
            const imageUrl = options.isProduction && options.r2PublicUrl
                ? `${options.r2PublicUrl}/${filename}`
                : `/uploads/${filename}`
            
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

    // AI : Session check endpoint
    app.get('/api/check-session', (c) => {
        const session = c.get('session')
        return c.json({
            userId: session.get('userId'),
            isAuthenticated: session.get('isAuthenticated'),
            username: session.get('username')
        })
    })

    // AI : Health check endpoint
    app.get('/api/health', (c) => {
        return c.json({ status: 'ok', timestamp: new Date().toISOString() })
    })

    return { app, appRouter }
}

export type AppRouter = ReturnType<typeof createApp>['appRouter']