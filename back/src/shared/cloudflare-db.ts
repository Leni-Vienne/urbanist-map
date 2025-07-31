// AI : Database configuration for Cloudflare Workers with Hyperdrive support
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from "postgres";
import * as schema from '../db/schema';

// AI : Create database client for Cloudflare Workers with Hyperdrive compatibility
export function createCloudflareDb(databaseUrl: string) {
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
