import { createAuthClient } from "better-auth/client";
import { getApiUrl } from "@/utils/apiUrl";

export const authClient = createAuthClient({
  baseURL: getApiUrl() || undefined,
  fetchOptions: {
    credentials: "include",
    customFetchImpl: (input, init) => fetch(input, init),
  },
});

// Keep the existing translated UI while Better Auth owns the wire error codes.
const errorMessages = new Map([
  ["INVALID_EMAIL", "auth.error.invalidEmail"],
  ["INVALID_PASSWORD", "auth.error.invalidCredentials"],
  ["INVALID_EMAIL_OR_PASSWORD", "auth.error.invalidCredentials"],
  ["EMAIL_NOT_VERIFIED", "auth.error.emailNotVerified"],
  ["USERNAME_TAKEN", "auth.error.usernameTaken"],
  ["PASSWORD_TOO_SHORT", "auth.error.passwordTooShort"],
  ["USER_BANNED", "auth.error.invalidCredentials"],
  ["MISSING_RESPONSE", "auth.error.invalidCaptcha"],
  ["VERIFICATION_FAILED", "auth.error.invalidCaptcha"],
]);

export function throwAuthError(
  error: { code?: string; message?: string; status?: number } | null,
): void {
  if (!error) return;
  const message =
    error.status === 429 ? "auth.error.tooManyRequests" : errorMessages.get(error.code ?? "");
  throw new Error(message ?? error.message ?? "Authentication failed");
}
