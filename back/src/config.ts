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
  // Public R2 CDN base (no trailing slash), e.g. "https://cdn.urbanistmap.org". Used by the SEO
  // route to emit absolute, auth-free og:image URLs that link-preview scrapers can fetch. Optional:
  // when unset (local dev), the SEO route falls back to the backend /uploads path.
  R2_PUBLIC_URL: z.url().optional(),
  // Public site origin (no trailing slash), e.g. "https://urbanistmap.org". Used to build canonical
  // URLs and sitemap entries. Defaults to the production apex.
  PUBLIC_SITE_URL: z.url().default("https://urbanistmap.org"),
});

const parsedEnv = envSchema.safeParse(env);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables.");
}

export const config = parsedEnv.data;
