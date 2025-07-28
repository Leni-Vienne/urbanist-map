// AI : Supabase configuration for Cloudflare Workers
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// AI : Environment schema for Supabase
const supabaseEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  DATABASE_URL: z.string().url()
});

// AI : Get Supabase config from environment
export function getSupabaseConfig(env: Record<string, string>) {
  const parsedEnv = supabaseEnvSchema.safeParse(env);

  if (!parsedEnv.success) {
    console.error('Invalid Supabase environment variables:', parsedEnv.error.issues);
    throw new Error('Invalid Supabase configuration');
  }

  return parsedEnv.data;
}

// AI : Create Supabase client for Cloudflare Workers
export function createSupabaseClient(supabaseUrl: string, supabaseKey: string) {
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}
