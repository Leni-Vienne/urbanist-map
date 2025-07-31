import { createCloudflareDb } from './cloudflare-db';
import { createSharedApp } from './create-app';
import { AppConfig } from './types';

// AI : Create Hono application for Cloudflare Workers
export async function createApp(config: AppConfig) {
    // AI : Setup database connection for Workers
    if (!config.databaseUrl || config.databaseUrl.includes('your-project.supabase.co')) {
        throw new Error('DATABASE_URL is required. Please configure your Supabase connection string.');
    }

    // AI : Create database instance for Cloudflare Workers
    const workersDb = createCloudflareDb(config.databaseUrl);

    // AI : Use shared app creation function
    return createSharedApp({
        ...config,
        database: workersDb,
        isProduction: true
    });
}

export type AppRouter = Awaited<ReturnType<typeof createApp>>['appRouter'];