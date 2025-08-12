import { createApp } from '../src/app'

// AI : Cloudflare Workers environment bindings
interface Env {
    ASSETS: { fetch: (request: Request) => Promise<Response> }
    R2_BUCKET?: R2Bucket
    HYPERDRIVE?: Hyperdrive
    JWT_SECRET: string
    CORS_ORIGIN?: string
    R2_PUBLIC_URL?: string
    DATABASE_URL?: string
    VITE_SUPABASE_URL?: string
    VITE_SUPABASE_ANON_KEY?: string
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url)
        
        try {
            // AI : Quick path for non-API requests - serve static assets
            if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/trpc/')) {
                let assetPath = url.pathname === '/' ? '/index.html' : url.pathname
                if (!assetPath.includes('.') && !assetPath.startsWith('/api/')) {
                    assetPath = '/index.html'
                }
                const assetRequest = new Request(`${url.origin}${assetPath}`, request)
                const response = await env.ASSETS.fetch(assetRequest)
                if (response.status === 404 && assetPath !== '/index.html') {
                    return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request))
                }
                return response
            }

            // AI : Database URL resolution with Hyperdrive support
            const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
            const databaseUrl = (isLocal && env.DATABASE_URL)
                ? env.DATABASE_URL
                : env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL!

            if (!databaseUrl) {
                throw new Error('No database connection available')
            }

            // AI : Create the unified app
            const { app } = createApp({
                corsOrigin: env.CORS_ORIGIN ?? 'https://construction-map.leni-vienne2.workers.dev',
                jwtSecret: env.JWT_SECRET ?? 'dev_jwt_secret_for_local_development_only_32_chars_minimum',
                databaseUrl,
                r2Bucket: env.R2_BUCKET,
                r2PublicUrl: env.R2_PUBLIC_URL,
                isProduction: !isLocal,
                supabaseUrl: env.VITE_SUPABASE_URL,
                supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY
            })
            
            return await app.fetch(request, env)

        } catch (error) {
            console.error('Worker error:', error)
            return new Response('Internal Server Error', { status: 500 })
        }
    }
}