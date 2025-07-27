// AI : Configuration for Cloudflare Pages - no dotenv, no top-level await
import { z } from 'zod';

// AI : Environment schema for Cloudflare Pages
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_ENCRYPTION_KEY: z.string().min(32),
  CORS_ORIGIN: z.string().url().optional(),
});

// AI : Get config from Cloudflare Pages environment
export function getCloudflareConfig(env: Record<string, string>) {
  const parsedEnv = envSchema.safeParse(env);

  if (!parsedEnv.success) {
    console.error('Invalid environment variables for Cloudflare Pages:', parsedEnv.error.issues);
    throw new Error('Invalid environment configuration');
  }

  return parsedEnv.data;
}
