import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { trpcServer } from '@hono/trpc-server'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from "postgres"
import * as schema from './db/schema'
import { createAppRouter } from './shared/routers'
import { LocalFileStorage, R2Storage } from './shared/storage'
import { createSupabaseAuthMiddleware, getAuthenticatedUser, type AuthUser } from './shared/auth'
import type { FileUploadResult, FileUploadError } from './shared/types'

interface AppOptions {
    corsOrigin: string | string[]
    databaseUrl: string
    r2Bucket?: R2Bucket
    r2PublicUrl?: string
    isProduction?: boolean
    supabaseJwtSecret?: string
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
            user: AuthUser | null
        }
    }>()

    const db = createDatabase(options.databaseUrl, options.isProduction)
    const storage = options.r2Bucket 
        ? new R2Storage(options.r2Bucket)
        : new LocalFileStorage()

    // AI : CORS for local development
    app.use('*', cors({
        origin: options.corsOrigin,
        credentials: true
    }))

    // AI : Supabase JWT authentication middleware
    if (options.supabaseJwtSecret) {
        app.use('*', createSupabaseAuthMiddleware(options.supabaseJwtSecret))
    } else {
        // AI : For development without Supabase auth, set user to null
        app.use('*', (c, next) => {
            c.set('user', null)
            return next()
        })
    }

    // AI : tRPC routes
    const appRouter = createAppRouter(db)
    app.use('/trpc/*', trpcServer({
        router: appRouter,
        createContext(_opts: any, c: any) {
            return {
                user: c.get('user')
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

    // AI : Check authentication status endpoint
    app.get('/api/auth/me', (c) => {
        const user = getAuthenticatedUser(c)
        return c.json({
            isAuthenticated: !!user,
            user: user ? {
                userId: user.id,
                email: user.email,
                username: user.user_metadata?.username || user.email?.split('@')[0],
                role: user.role
            } : null
        })
    })

    // AI : Health check endpoint
    app.get('/api/health', (c) => {
        return c.json({ status: 'ok', timestamp: new Date().toISOString() })
    })

    return { app, appRouter }
}

export type AppRouter = ReturnType<typeof createApp>['appRouter']