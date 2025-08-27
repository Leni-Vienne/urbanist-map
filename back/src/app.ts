import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { trpcServer } from '@hono/trpc-server'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from "postgres"
import * as schema from './db/schema'
import { createAppRouter } from './shared/routers'
import { LocalFileStorage, R2Storage } from './shared/storage'
import { createAuthMiddleware, getAuthenticatedUser, type DBUser } from './shared/auth'
import type { FileUploadResult, FileUploadError } from './shared/types'

interface AppOptions {
    corsOrigin: string | string[]
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
            user: DBUser | null
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

    // AI : Custom session-based authentication middleware
    app.use('*', createAuthMiddleware())

    // AI : tRPC routes
    const appRouter = createAppRouter(db)
    app.use('/trpc/*', trpcServer({
        router: appRouter,
        createContext(_opts: any, c: any) {
            return {
                user: c.get('user'),
                hono: c
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
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
                emailVerified: user.emailVerified
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