import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { auth } from "../lib/auth";
import { resolveSessionUser } from "../lib/currentUser";
import { db } from "../database";
import { config } from "../db/schema";
import type { AppEnv } from "../lib/types";

export const authApp = new Hono<AppEnv>();
authApp.all("/api/auth/*", (c) => auth.handler(c.req.raw));

// Application profile and site configuration, separate from the auth protocol.
authApp.get("/api/check-session", async (c) => {
  const user = await resolveSessionUser(c);
  const [settings] = await db
    .select({ infoMessage: config.infoMessage })
    .from(config)
    .where(eq(config.id, 1));
  return c.json({ user, infoMessage: settings?.infoMessage ?? null });
});
