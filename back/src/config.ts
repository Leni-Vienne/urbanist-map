import { z } from 'zod';

// AI : Support for both local development and Cloudflare Pages
let env = process.env;

// AI : In local development, load .env file
if (typeof Bun !== 'undefined' && (!env.DATABASE_URL || env.DATABASE_URL.includes('localhost'))) {
    try {
        const dotenv = await import('dotenv');
        dotenv.config({ path: '../../../.env', override: false });
        env = process.env;
    } catch {
        // AI : dotenv might not be available in production, that's fine
        console.log('Running without dotenv (production mode)');
    }
}

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_ENCRYPTION_KEY: z.string().min(32),
  CORS_ORIGIN: z.string().url(),
  PORT: z.coerce.number().default(3000),
});

const parsedEnv = envSchema.safeParse(env);

if (!parsedEnv.success) {
  console.error(
    '❌ Invalid environment variables:',
    parsedEnv.error.flatten().fieldErrors,
  );
  throw new Error('Invalid environment variables.');
}

export const config = parsedEnv.data;
