import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { config } from './config'
import { createApp } from './app'
import type { JWTPayload } from './shared/types'

// AI : Create the unified app for local development
const { app: coreApp, appRouter } = createApp({
    corsOrigin: config.CORS_ORIGIN,
    jwtSecret: config.JWT_SECRET,
    databaseUrl: config.DATABASE_URL,
    isProduction: false,
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY
})

// AI : Wrap with static file serving for bun
const app = new Hono<{
    Variables: {
        user: JWTPayload | null
    }
}>()

// AI : Mount the core app routes
app.route('/', coreApp)

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

export type AppRouter = typeof appRouter

export default {
    port: config.PORT,
    fetch: app.fetch
}
