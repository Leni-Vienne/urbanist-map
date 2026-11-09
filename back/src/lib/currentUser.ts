import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { auth, deleteUserSessions } from "./auth";
import { db } from "../database";
import { users } from "../db/schema";
import type { AppEnv, SessionUser } from "./types";

// Better Auth validates the session; application capabilities always come from
// the current user row so bans and moderation changes take effect immediately.
export async function resolveSessionUser<E extends AppEnv>(
  c: Context<E>,
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return null;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      moderatedCountries: users.moderatedCountries,
      emailVerified: users.emailVerified,
      banned: users.banned,
    })
    .from(users)
    .where(eq(users.id, session.user.id));
  if (!user || user.banned) {
    await deleteUserSessions(session.user.id);
    return null;
  }
  const { banned: _banned, ...currentUser } = user;
  c.set("user", currentUser);
  return currentUser;
}
