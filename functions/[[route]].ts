import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { createApp } from '../back/src/shared/app';
import { R2Storage } from '../back/src/shared/storage';

// AI : Cloudflare Pages environment bindings
interface Env {
    R2_BUCKET?: R2Bucket;
    DATABASE_URL: string;
    SESSION_ENCRYPTION_KEY: string;
    CORS_ORIGIN: string;
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
}

// AI : Create main app for Cloudflare Pages
const app = new Hono<{ Bindings: Env }>()

// AI : Middleware to inject configuration and mount shared app
app.use('*', async (c) => {
    const storage = c.env.R2_BUCKET ? new R2Storage(c.env.R2_BUCKET) : {
        put: async () => { throw new Error('R2 storage not configured') },
        get: async () => null
    };

    const { app: sharedApp, appRouter: _appRouter } = await createApp({
        corsOrigin: ['https://construction-map.pages.dev', 'http://localhost:8788'],
        sessionEncryptionKey: c.env.SESSION_ENCRYPTION_KEY || 'a_very_long_and_secure_secret_key_of_at_least_32_chars',
        storage,
        databaseUrl: c.env.DATABASE_URL
    });

    // AI : Forward request to shared app
    return sharedApp.fetch(c.req.raw, c.env, c.executionCtx);
});

// AI : Export the handler for Cloudflare Pages
export const onRequest = handle(app);
