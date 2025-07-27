import { createApp } from '../back/src/shared/app';
import { EnhancedR2Storage } from '../back/src/shared/cloudflare-storage';

// AI : Cloudflare Workers environment bindings
interface Env {
    R2_BUCKET?: R2Bucket;
    SESSION_ENCRYPTION_KEY: string;
    CORS_ORIGIN?: string;
    DATABASE_URL?: string; // AI : Supabase PostgreSQL URL
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        // AI : Create storage based on available services
        let storage;
        if (env.R2_BUCKET) {
            storage = new EnhancedR2Storage(env.R2_BUCKET);
        } else {
            // AI : Fallback storage that throws errors
            storage = {
                put: async () => { throw new Error('R2 storage not configured') },
                get: async () => null
            };
        }

        // AI : Create the app with environment configuration
        const { app } = createApp({
            corsOrigin: env.CORS_ORIGIN || 'https://your-domain.pages.dev',
            sessionEncryptionKey: env.SESSION_ENCRYPTION_KEY,
            storage,
            databaseUrl: env.DATABASE_URL
        });

        return app.fetch(request, env);
    }
};
