import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from "postgres";
import * as schema from '../db/schema';
import { createSharedApp } from './create-app';
import { AppConfig } from './types';

// AI : Create database client for Cloudflare Workers with Hyperdrive compatibility
function createCloudflareDb(databaseUrl: string) {
  try {
    const client = postgres(databaseUrl, {
      // Limit the connections for the Worker request to 5 due to Workers' limits on concurrent external connections
      max: 5,
      // If you are not using array types in your Postgres schema, disable `fetch_types` to avoid an additional round-trip (unnecessary latency)
      fetch_types: false,
    });

    return drizzle(client, { schema });
  } catch (error) {
    console.error('AI : Failed to create database client:', error);
    throw error;
  }
}

// AI : Create Hono application for Cloudflare Workers
export function createApp(config: AppConfig) {
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

export type AppRouter = ReturnType<typeof createApp>['appRouter'];