import { createApp } from '../back/src/shared/app';
import { R2Storage, LocalFileStorage } from '../back/src/shared/storage';

// AI : Cloudflare Workers environment bindings
interface Env {
    ASSETS: { fetch: (request: Request) => Promise<Response> }; // AI : Static assets binding
    R2_BUCKET?: R2Bucket;
    SESSION_ENCRYPTION_KEY: string;
    CORS_ORIGIN?: string;
    R2_PUBLIC_URL?: string;
    DATABASE_URL?: string; // AI : Supabase PostgreSQL URL
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        
        try {
            // AI : Check if this is an API request
            if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/trpc/')) {
                // AI : Create storage based on available services
                let storage;
                if (env.R2_BUCKET) {
                    storage = new R2Storage(env.R2_BUCKET);
                } else {
                    // AI : Use local file storage for development
                    storage = new LocalFileStorage();
                }

                // AI : Create the app with environment configuration - DATABASE_URL is required
                if (!env.DATABASE_URL) {
                    throw new Error('DATABASE_URL is required. Please set it in your Worker environment variables.');
                }

                const { app } = await createApp({
                    corsOrigin: env.CORS_ORIGIN ?? 'https://construction-map.leni-vienne2.workers.dev',
                    sessionEncryptionKey: env.SESSION_ENCRYPTION_KEY ?? 'dev_key_for_local_development_only_32_chars_min',
                    storage,
                    databaseUrl: env.DATABASE_URL,
                    r2PublicUrl: env.R2_PUBLIC_URL
                });

                return app.fetch(request, env);
            }

            // AI : For non-API requests, serve static frontend files
            // AI : Handle root path and SPA routing
            let assetPath = url.pathname;
            if (assetPath === '/' || assetPath === '') {
                assetPath = '/index.html';
            }
            
            // AI : For paths that don't have file extensions and aren't API routes,
            // AI : serve index.html for SPA routing
            if (!assetPath.includes('.') && !assetPath.startsWith('/api/') && !assetPath.startsWith('/trpc/')) {
                assetPath = '/index.html';
            }

            // AI : Fetch the static asset
            const assetRequest = new Request(`${url.origin}${assetPath}`, request);
            const assetResponse = await env.ASSETS.fetch(assetRequest);
            
            if (assetResponse.status === 404 && assetPath !== '/index.html') {
                // AI : If asset not found and it's not already index.html, serve index.html for SPA
                const indexRequest = new Request(`${url.origin}/index.html`, request);
                return env.ASSETS.fetch(indexRequest);
            }
            
            return assetResponse;
            
        } catch (error) {
            console.error('Worker error:', error);
            return new Response('Internal Server Error', { status: 500 });
        }
    }
};
