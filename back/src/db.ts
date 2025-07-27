import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from './config';
import * as schema from './db/schema';

// AI : Direct database connection for local development
const client = postgres(config.DATABASE_URL, {
    ssl: config.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 1, // AI : Conservative connection limit
});

export const db = drizzle(client, { schema });

// AI : Database factory function for Workers context (when config import is not available)
export function createDatabase(databaseUrl: string) {
    const client = postgres(databaseUrl, {
        ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        max: 1,
    });
    
    return drizzle(client, { schema });
}
