import { eq } from "drizzle-orm";
import { db } from "../database";
import { users } from "../db/schema";
import type { Session } from "hono-sessions";
import type { SessionUser } from "./types";

// Reloads the authenticated user from the database on every request. The session cookie only
// carries an id; role, moderatedCountries and ban state are always read fresh so a demotion or
// ban takes effect immediately instead of on session expiry.
export async function resolveSessionUser(
  session: Session<{ user?: SessionUser }>,
): Promise<SessionUser | null> {
  const sessionUser = session.get("user");
  if (!sessionUser) return null;

  const [fresh] = await db
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
    .where(eq(users.id, sessionUser.id))
    .limit(1);

  if (!fresh || fresh.banned) {
    session.deleteSession();
    return null;
  }

  return {
    id: fresh.id,
    email: fresh.email,
    username: fresh.username,
    role: fresh.role,
    moderatedCountries: fresh.moderatedCountries,
    emailVerified: fresh.emailVerified,
  };
}
