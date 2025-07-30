import { createSharedApp } from './create-app';
import { AppConfig } from './types';
import { db } from '../db';

// AI : Create local development app with full tRPC support
export async function createLocalApp(config: AppConfig) {
    console.log('AI : Setting up tRPC with local database...');
    
    // AI : Use shared app creation function with local database
    return createSharedApp({
        ...config,
        database: db,
        isProduction: false
    });
}

export type LocalAppRouter = Awaited<ReturnType<typeof createLocalApp>>['appRouter'];