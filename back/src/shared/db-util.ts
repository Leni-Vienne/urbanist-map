import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

// AI : Get database instance - works with global assignment from router factory
export function getDb(): PostgresJsDatabase<typeof schema> {
  const db = (globalThis as any).__workersDb;
  
  if (!db) {
    throw new Error('Database not initialized. Make sure the router factory has set up the database.');
  }
  
  return db;
}
