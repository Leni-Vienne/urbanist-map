// AI : Database configuration for Cloudflare Pages
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema';

// AI : Create database client for Cloudflare Pages
export function createCloudflareDb(databaseUrl: string) {
  const client = postgres(databaseUrl);
  return drizzle(client, { schema });
}
