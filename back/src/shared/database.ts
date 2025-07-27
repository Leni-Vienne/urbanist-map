import { createClient } from '@supabase/supabase-js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'

// AI : Database configuration that works in both local and Cloudflare Workers
export function createDatabase(config: {
  supabaseUrl?: string;
  supabaseKey?: string;
  databaseUrl?: string;
}) {
  // AI : For Cloudflare Workers - use Supabase client
  if (config.supabaseUrl && config.supabaseKey) {
    const supabase = createClient(config.supabaseUrl, config.supabaseKey);
    
    // AI : Create a custom postgres-js connection using Supabase's connection string
    const connectionString = config.databaseUrl || `postgresql://${config.supabaseUrl}`;
    const client = postgres(connectionString, {
      ssl: { rejectUnauthorized: false },
      max: 1, // AI : Cloudflare Workers have connection limits
    });
    
    return {
      db: drizzle(client, { schema }),
      supabase,
      client
    };
  }
  
  // AI : For local development - direct postgres connection
  if (config.databaseUrl) {
    const client = postgres(config.databaseUrl);
    return {
      db: drizzle(client, { schema }),
      supabase: null,
      client
    };
  }
  
  throw new Error('Database configuration missing');
}
