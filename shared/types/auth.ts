// User profile exposed by login, email verification, and session-check responses.
export interface AuthUser {
  id: string;
  email: string;
  username: string | null;
  role: string | null;
  moderatedCountries: string[] | null; // ISO 3-letter country codes; null for unrestricted admins
  emailVerified: boolean;
}
