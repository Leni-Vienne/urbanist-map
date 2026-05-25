// Shared types used by both frontend and backend
export type { ApprovalStatus } from "../back/src/db/schema";

// Type for map viewing modes (used by both frontend and backend)
export type AppMode = "view" | "edit" | "moderation";

// OAuth providers supported for sign-in and linked accounts
export type OAuthProvider = "google" | "osm";

// Redirect providers that expose no email (OSM) get a synthetic, non-routable address
// on this domain. The UI uses isSyntheticEmail to avoid showing it as real contact info.
export const SYNTHETIC_EMAIL_DOMAIN = "users.urbanistmap.org";

export function isSyntheticEmail(email: string): boolean {
  return email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}
