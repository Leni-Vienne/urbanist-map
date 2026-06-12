import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';

// Support for both local development and Cloudflare Pages
// For local development, use Bun's built-in .env support or manual loading
const env = process.env;

const envSchema = z.object({
  DATABASE_URL: z.url(),
  CORS_ORIGIN: z.string(),
  PORT: z.coerce.number().default(3000),
  // Session cookie encryption key. Required everywhere so the server never boots
  // with a known/guessable secret.
  COOKIE_SECRET: z.string().min(32),
});

const parsedEnv = envSchema.safeParse(env);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables.");
}

export const config = parsedEnv.data;
