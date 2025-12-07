import * as z from "zod"; // smaller bundle compared to 'import { z } from 'zod';

// AI : Support for both local development and Cloudflare Pages
// AI : For local development, use Bun's built-in .env support or manual loading
let env = process.env;

const envSchema = z.object({
  DATABASE_URL: z.url(),
  CORS_ORIGIN: z.string(),
  PORT: z.coerce.number().default(3000),
});

const parsedEnv = envSchema.safeParse(env);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables.");
}

export const config = parsedEnv.data;
