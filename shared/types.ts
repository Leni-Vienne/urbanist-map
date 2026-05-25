// Shared types used by both frontend and backend
export type { ApprovalStatus } from "../back/src/db/schema";

// Type for map viewing modes (used by both frontend and backend)
export type AppMode = "view" | "edit" | "moderation";

// OAuth providers supported for sign-in and linked accounts
export type OAuthProvider = "google" | "osm";
