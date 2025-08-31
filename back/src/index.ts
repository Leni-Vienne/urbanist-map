import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { trpcServer } from '@hono/trpc-server'
import { appRouter } from './shared/routers'
import { LocalFileStorage } from './shared/storage'
import { createAuthMiddleware, getAuthenticatedUser } from './shared/auth'
import type { DBUser } from './db/schema'
import type { FileUploadResult, FileUploadError } from './shared/types'
import { config } from './config'
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch'
import type { Context } from 'hono'

// AI : Main application setup
const app = new Hono<{
    Variables: {
        user: DBUser | null
    }
}>()

const storage = new LocalFileStorage()

// AI : CORS for local development
app.use('*', cors({
    origin: config.CORS_ORIGIN,
    credentials: true
}))

// AI : Custom session-based authentication middleware
app.use('*', createAuthMiddleware())

// AI : tRPC routes
app.use('/trpc/*', trpcServer({
    router: appRouter,
    createContext(_opts: FetchCreateContextFnOptions, c: Context) {
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
