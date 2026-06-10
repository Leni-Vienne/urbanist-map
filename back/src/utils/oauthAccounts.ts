import { and, eq } from "drizzle-orm";
import type { OAuthProvider } from "@shared/types";
import { db } from "../database";
import { users, oauthAccounts } from "../db/schema";

type UserRow = typeof users.$inferSelect;

export interface OAuthProfile {
  provider: OAuthProvider;
  providerAccountId: string; // the provider's stable unique id (Google sub, OSM numeric id)
  email: string; // real for Google, synthetic for OSM (it never exposes an email)
  name: string; // used as the initial username
  // Whether THIS response's email is provider-verified (e.g. Google's email_verified
  // claim), not a static property of the provider. Gates linking to / updating an
  // existing account. Always false for providers that expose no verified email (OSM).
  trustProviderEmail: boolean;
}

function oauthConflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409, action: "account_conflict" });
}

export async function getUserOAuthProviders(userId: string): Promise<string[]> {
  const rows = await db
    .select({ provider: oauthAccounts.provider })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.userId, userId));
  return rows.map((row) => row.provider);
}

// Adopt a Google-side email change onto the existing account.
async function updateUserEmail(user: UserRow, newEmail: string): Promise<UserRow> {
  try {
    const [updated] = await db
      .update(users)
      .set({ email: newEmail, emailVerified: true, emailVerificationToken: null })
      .where(eq(users.id, user.id))
      .returning();
    return updated ?? user;
  } catch (error: any) {
    if (
      error.code === "23505" ||
      error.message?.includes("unique constraint") ||
      error.message?.includes("duplicate key")
    ) {
      throw oauthConflict("auth.error.emailTaken");
    }
    throw error;
  }
}

// Insert a new user plus its identity row atomically, retrying the username on
// uniqueness conflicts (TOCTOU-safe, no check-then-insert race).
async function createOAuthUser(profile: OAuthProfile): Promise<UserRow> {
  const baseUsername = profile.name;
  let username = baseUsername;
  let counter = 1;

  // eslint-disable-next-line no-unnecessary-condition
  while (true) {
    try {
      return await db.transaction(async (tx) => {
        const [newUser] = await tx
          .insert(users)
          .values({
            email: profile.email,
            username,
            emailVerified: true,
            passwordHash: null,
            moderatedCountries: [],
          })
          .returning();

        if (!newUser) {
          throw new Error("User insert returned no row");
        }

        await tx.insert(oauthAccounts).values({
          userId: newUser.id,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        });

        return newUser;
      });
    } catch (error: any) {
      if (error.code === "23505" && error.constraint === "users_username_unique") {
        username = `${baseUsername}${counter}`;
        // eslint-disable-next-line no-useless-assignment
        counter += 1;
      } else {
        throw error;
      }
    }
  }
}

// Resolve an OAuth sign-in to a user account: match by identity, then (for verified
// emails) link to an existing account, otherwise create a fresh one.
export async function findOrCreateOAuthUser(profile: OAuthProfile): Promise<UserRow> {
  const [identity] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, profile.provider),
        eq(oauthAccounts.providerAccountId, profile.providerAccountId),
      ),
    )
    .limit(1);

  if (identity) {
    const [user] = await db.select().from(users).where(eq(users.id, identity.userId)).limit(1);
    if (!user) {
      throw new Error("OAuth identity references a missing user");
    }
    if (profile.trustProviderEmail && user.email !== profile.email) {
      console.log(`[oauth] ${profile.provider} updated the email for user ${user.id}`);
      return updateUserEmail(user, profile.email);
    }
    return user;
  }

  // Link to an existing local account only when this response's email is verified.
  if (profile.trustProviderEmail) {
    const [emailUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, profile.email))
      .limit(1);

    if (emailUser) {
      const providers = await getUserOAuthProviders(emailUser.id);
      if (providers.includes(profile.provider)) {
        // This email's account already has a different identity for this provider
        throw oauthConflict("auth.error.emailLinkedToOtherAccount");
      }

      await db.insert(oauthAccounts).values({
        userId: emailUser.id,
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      });

      if (!emailUser.emailVerified) {
        await db
          .update(users)
          .set({ emailVerified: true, emailVerificationToken: null })
          .where(eq(users.id, emailUser.id));
      }

      return { ...emailUser, emailVerified: true };
    }
  }

  return createOAuthUser(profile);
}
