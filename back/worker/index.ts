import { createApp } from '../src/shared/app'
import { R2Storage, LocalFileStorage } from '../src/shared/storage'
import type { AppConfig } from '../src/shared/types'

// AI : Cloudflare Workers environment bindings
interface Env {
    ASSETS: { fetch: (request: Request) => Promise<Response> };
    R2_BUCKET?: R2Bucket;
    HYPERDRIVE?: Hyperdrive;
    SESSION_ENCRYPTION_KEY: string;
    CORS_ORIGIN?: string;
    R2_PUBLIC_URL?: string;
    DATABASE_URL?: string;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        
        try {
            // AI : Quick path for non-API requests - serve static assets
            if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/trpc/')) {
                let assetPath = url.pathname === '/' ? '/index.html' : url.pathname;
                if (!assetPath.includes('.') && !assetPath.startsWith('/api/')) {
                    assetPath = '/index.html';
                }
                const assetRequest = new Request(`${url.origin}${assetPath}`, request);
                const response = await env.ASSETS.fetch(assetRequest);
                if (response.status === 404 && assetPath !== '/index.html') {
                    return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
                }
                return response;
            }

            // AI : Setup storage based on environment
            const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
            const storage = env.R2_BUCKET 
                ? new R2Storage(env.R2_BUCKET)
                : new LocalFileStorage();

            // AI : Database URL resolution with Hyperdrive support
            const databaseUrl = (isLocal && env.DATABASE_URL)
                ? env.DATABASE_URL
                : env.HYPERDRIVE?.connectionString || env.DATABASE_URL!;

            if (!databaseUrl) {
                throw new Error('No database connection available');
            }

            // AI : Create app configuration
            const config: AppConfig = {
                corsOrigin: env.CORS_ORIGIN ?? 'https://construction-map.leni-vienne2.workers.dev',
                sessionEncryptionKey: env.SESSION_ENCRYPTION_KEY ?? 'dev_key_for_local_development_only_32_chars_min',
                storage,
                databaseUrl,
                isProduction: !isLocal,
                r2PublicUrl: env.R2_PUBLIC_URL
            };

            // AI : Create the app using shared function
            const { app } = createApp(config);
            
            return await app.fetch(request, env);

        } catch (error) {
            console.error('Worker error:', error);
            return new Response('Internal Server Error', { status: 500 });
        }
    }
};