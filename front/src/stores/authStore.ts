import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import { trpc, getApiUrl } from "@/client";

// User type for our custom authentication
interface User {
  id: string;
  email: string;
  username: string | null;
  role: string | null;
  moderatedCountries: string[] | null; // Array of ISO 3-letter country codes (null = admin with all countries)
  emailVerified: boolean;
}

type AuthResult = { success: boolean; user: User | null; error: string | null };

async function loadGoogleIdentityScript() {
  return new Promise<void>((resolve, reject) => {
    if (globalThis.google) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;

    script.addEventListener("load", () => {
      resolve();
    });
    script.addEventListener("error", () => {
      reject(new Error("Failed to load Google Identity Services"));
    });

    document.head.appendChild(script);
  });
}

type LastUsedMethod = "email" | "google" | "osm";
type LastUsed = { method: LastUsedMethod; email: string | null };

// Single global record of the most recent sign-in, powering the "last used" hint in
// the auth modal. Global rather than per-email so redirect providers like OSM (which
// expose no typed email) share one timeline and exactly one method is ever marked.
function getLastUsedMethod(): LastUsed | null {
  try {
    const raw = localStorage.getItem("lastUsedMethod");
    // oxlint-disable-next-line no-unsafe-type-assertion
    return raw ? (JSON.parse(raw) as LastUsed) : null;
  } catch {
    return null;
  }
}

function setLastUsedMethod(method: LastUsedMethod, email: string | null = null) {
  try {
    localStorage.setItem("lastUsedMethod", JSON.stringify({ method, email }));
  } catch {
    // localStorage unavailable (private mode); the hint is non-critical
  }
}

// OSM uses a full-page authorization-code redirect, so this navigates away and
// never returns; the backend handles the callback and redirects back to the SPA.
function startOsmLogin(rememberMe: boolean): void {
  const rememberParam = rememberMe ? "true" : "false";
  globalThis.location.href = `${getApiUrl()}/api/osm-login?rememberMe=${rememberParam}`;
}

async function sendGoogleTokenToBackend(credential: string, rememberMe: boolean) {
  const response = await fetch(`${getApiUrl()}/api/google-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: credential, rememberMe }),
    credentials: "include",
  });

  const data: { success: boolean; user?: User; error?: string } = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error ?? "Google authentication failed");
  }

  return data.user ?? null;
}

// Wraps a provider-specific token-exchange call into an OAuth SDK callback.
// The returned handler clears the pending timeout, awaits the exchange, and resolves
// the outer promise with a uniform AuthResult shape regardless of provider.
function createOAuthCallbackHandler<TResponse>(options: {
  provider: "google";
  exchangeToken: (response: TResponse) => Promise<User | null>;
  timeoutId: ReturnType<typeof setTimeout>;
  resolve: (value: AuthResult) => void;
}) {
  return (response: TResponse) => {
    clearTimeout(options.timeoutId);
    void (async () => {
      try {
        const newUser = await options.exchangeToken(response);
        options.resolve({ success: true, user: newUser, error: null });
      } catch (error: unknown) {
        console.error(`${options.provider} OAuth error:`, error);
        options.resolve({
          success: false,
          user: null,
          error:
            error instanceof Error ? error.message : `${options.provider} authentication failed`,
        });
      }
    })();
  };
}

// Sign up with email and password
async function signUp(email: string, password: string, username: string, captchaToken?: string) {
  try {
    const result = await trpc.account.register.mutate({
      email,
      password,
      username,
      captchaToken,
    });

    return {
      success: result.success,
      error: result.success ? null : result.message,
    };
  } catch (error: unknown) {
    console.error("Sign up error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Registration failed",
    };
  }
}

// Verify email
async function verifyEmail(token: string) {
  try {
    const result = await trpc.account.verifyEmail.mutate({ token });
    return {
      success: result.success,
      user: result.user,
      error: result.success ? null : result.message,
    };
  } catch (error: unknown) {
    console.error("Email verification error:", error);
    return {
      success: false,
      user: null,
      error: error instanceof Error ? error.message : "Email verification failed",
    };
  }
}

async function requestPasswordReset(email: string) {
  try {
    const result = await trpc.account.requestPasswordReset.mutate({ email });
    return {
      success: result.success,
      error: result.success ? null : result.message,
    };
  } catch (error: unknown) {
    console.error("Password reset request error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Password reset request failed",
    };
  }
}

async function resetPassword(token: string, password: string) {
  try {
    const result = await trpc.account.resetPassword.mutate({ token, password });
    return {
      success: result.success,
      email: result.success ? result.email : null,
      error: result.success ? null : result.message,
    };
  } catch (error: unknown) {
    console.error("Password reset error:", error);
    return {
      success: false,
      email: null,
      error: error instanceof Error ? error.message : "Password reset failed",
    };
  }
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const infoMessage = ref<string | null>(null);

  const isAuthenticated = computed(() => Boolean(user.value));
  const isModerator = computed(() => {
    if (!user.value) return false;
    if (user.value.role === "admin") return true;
    return (user.value.moderatedCountries?.length ?? 0) > 0;
  });

  // Cached promise so concurrent callers share the same in-flight request
  let initPromise: Promise<void> | null = null;

  // Idempotent: subsequent calls return the same promise
  async function initialize(): Promise<void> {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        // Try to get current user from server (will use session cookies)
        const response = await fetch(`${getApiUrl()}/api/check-session`, {
          credentials: "include",
        });

        if (response.ok) {
          const result: { user: User | null; infoMessage: string | null } = await response.json();
          user.value = result.user;
          infoMessage.value = result.infoMessage;
          if (!result.user) return;
        } else {
          user.value = null;
          infoMessage.value = null;
        }
      } catch (error) {
        console.error("Error initializing auth:", error);
        user.value = null;
        infoMessage.value = null;
      }
    })();

    return initPromise;
  }

  async function signIn(email: string, password: string, rememberMe = false) {
    try {
      const response = await fetch(`${getApiUrl()}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, rememberMe }),
        credentials: "include",
      });

      const result: { success: boolean; user?: User; error?: string; message?: string } =
        await response.json();

      if (response.ok && result.success) {
        user.value = result.user ?? null;
        setLastUsedMethod("email", result.user?.email ?? null);
        return {
          success: true,
          error: null,
        };
      } else {
        return {
          success: false,
          error: result.error ?? result.message ?? "Login failed",
        };
      }
    } catch (error: unknown) {
      console.error("Sign in error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Login failed",
      };
    }
  }

  async function signInWithOAuth(
    provider: "google",
    rememberMe = false,
  ): Promise<{ success: boolean; error: string | null }> {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      return { success: false, error: "Google Client ID not configured" };
    }

    try {
      if (!globalThis.google) {
        await loadGoogleIdentityScript();
      }
      if (!globalThis.google) {
        return { success: false, error: "Google Identity Services not loaded" };
      }

      const result = await new Promise<AuthResult>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ success: false, user: null, error: "Google authentication timed out" });
        }, 60_000);

        globalThis.google?.accounts.id.initialize({
          client_id: clientId,
          callback: createOAuthCallbackHandler<{ credential: string }>({
            provider,
            exchangeToken: async (response) =>
              sendGoogleTokenToBackend(response.credential, rememberMe),
            timeoutId: timeout,
            resolve,
          }),
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        // @ts-ignore -- Google Identity Services prompt() types are incomplete
        globalThis.google?.accounts.id.prompt((notification: any) => {
          if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
            clearTimeout(timeout);
            resolve({
              success: false,
              user: null,
              error: "Google sign-in was cancelled or not displayed",
            });
          }
        });
      });

      if (result.success) {
        user.value = result.user;
        setLastUsedMethod(provider, result.user?.email ?? null);
      }
      return { success: result.success, error: result.error };
    } catch (error: unknown) {
      console.error(`${provider} OAuth error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : `${provider} authentication failed`,
      };
    }
  }

  async function signOut() {
    try {
      const response = await fetch(`${getApiUrl()}/api/logout`, {
        method: "POST",
        credentials: "include",
      });

      user.value = null;
      // Reset initPromise so initialize() re-runs after re-login
      initPromise = null;

      if (response.ok) {
        return { success: true, error: null };
      } else {
        const result: { error?: string } = await response.json();
        return { success: false, error: result.error ?? "Logout failed" };
      }
    } catch (error: unknown) {
      console.error("Sign out error:", error);
      // Clear local data even if server logout fails
      user.value = null;
      return { success: false, error: error instanceof Error ? error.message : "Logout failed" };
    }
  }

  return {
    user,
    infoMessage,
    isAuthenticated,
    isModerator,
    initialize,
    signUp,
    signIn,
    signInWithOAuth,
    signOut,
    verifyEmail,
    requestPasswordReset,
    resetPassword,
    getLastUsedMethod,
    setLastUsedMethod,
    startOsmLogin,
  };
});

// Enable HMR for this store
// oxlint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
}
