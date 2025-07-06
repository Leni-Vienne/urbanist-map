import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: '../../../.env' });

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_ENCRYPTION_KEY: z.string().min(32),
  CORS_ORIGIN: z.string().url(),
  PORT: z.coerce.number().default(3000),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error(
    '❌ Invalid environment variables:',
    parsedEnv.error.flatten().fieldErrors,
  );
  throw new Error('Invalid environment variables.');
}

export const config = parsedEnv.data;
