import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import { authClient, throwAuthError } from "@/services/auth/client";
import { getApiUrl } from "@/utils/apiUrl";
import type { AuthUser } from "@shared/types/auth";

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

type AuthResult = { success: boolean; error: string | null };

function failed(error: unknown): AuthResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : "Authentication failed",
  };
}

async function signUp(
  email: string,
  password: string,
  username: string,
  captchaToken?: string,
): Promise<AuthResult> {
  try {
    const result = await authClient.signUp.email({
      email,
      password,
      name: username,
      fetchOptions: { headers: { "x-captcha-response": captchaToken ?? "" } },
    });
    throwAuthError(result.error);
    return { success: true, error: null };
  } catch (error) {
    return failed(error);
  }
}

async function requestPasswordReset(email: string): Promise<AuthResult> {
  try {
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: `${globalThis.location.origin}/reset-password`,
    });
    throwAuthError(result.error);
    return { success: true, error: null };
  } catch (error) {
    return failed(error);
  }
}

async function signInWithOAuth(provider: "google" | "osm"): Promise<AuthResult> {
  try {
    const result = await authClient.signIn.social({
      provider,
      callbackURL: `${globalThis.location.origin}/?auth=success&provider=${provider}`,
      errorCallbackURL: `${globalThis.location.origin}/`,
    });
    throwAuthError(result.error);
    return { success: true, error: null };
  } catch (error) {
    return failed(error);
  }
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthUser | null>(null);
  const infoMessage = ref<string | null>(null);
  const version = computed(() =>
    infoMessage.value && /^v\d+\.\d+\.\d+$/.test(infoMessage.value.trim())
      ? infoMessage.value.trim()
      : null,
  );
  const isAuthenticated = computed(() => Boolean(user.value));
  const isModerator = computed(
    () => user.value?.role === "admin" || (user.value?.moderatedCountries?.length ?? 0) > 0,
  );

  let sessionEpoch = 0;
  let initPromise: Promise<void> | null = null;
  let mutation: Promise<AuthResult> | null = null;

  function getSessionEpoch() {
    return sessionEpoch;
  }

  async function loadSession(epoch: number) {
    try {
      const response = await fetch(`${getApiUrl()}/api/check-session`, { credentials: "include" });
      if (!response.ok) throw new Error("Session check failed");
      const result: { user: AuthUser | null; infoMessage: string | null } = await response.json();
      if (epoch !== sessionEpoch) return;
      user.value = result.user;
      infoMessage.value = result.infoMessage;
    } catch (error) {
      if (epoch !== sessionEpoch) return;
      console.error("Error initializing auth:", error);
      user.value = null;
      infoMessage.value = null;
      initPromise = null;
    }
  }

  async function initialize(): Promise<void> {
    if (mutation) {
      await mutation;
      return initialize();
    }
    const epoch = sessionEpoch;
    initPromise ??= loadSession(epoch);
    await initPromise;
    if (epoch !== sessionEpoch) await initialize();
  }

  // Keep auth changes ordered and invalidate user-scoped async work immediately.
  // Provider protocol, token verification, and cookies belong to Better Auth.
  async function changeSession(operation: () => Promise<void>): Promise<AuthResult> {
    const epoch = ++sessionEpoch;
    initPromise = null;
    const previous = mutation;
    const request = (async () => {
      if (previous) await previous;
      try {
        await operation();
        if (epoch !== sessionEpoch) return { success: false, error: "Authentication superseded" };
        initPromise = loadSession(epoch);
        await initPromise;
        return { success: true, error: null };
      } catch (error) {
        return failed(error);
      }
    })();
    mutation = request;
    try {
      return await request;
    } finally {
      if (mutation === request) mutation = null;
    }
  }

  function signIn(email: string, password: string, rememberMe = false) {
    return changeSession(async () => {
      const result = await authClient.signIn.email({ email, password, rememberMe });
      throwAuthError(result.error);
      setLastUsedMethod("email", email);
    });
  }

  function verifyEmail(token: string) {
    return changeSession(async () => {
      const result = await authClient.verifyEmail({ query: { token } });
      throwAuthError(result.error);
    });
  }

  function resetPassword(token: string, password: string) {
    return changeSession(async () => {
      const result = await authClient.resetPassword({ token, newPassword: password });
      throwAuthError(result.error);
      user.value = null;
    });
  }

  function signOut() {
    user.value = null;
    return changeSession(async () => {
      const result = await authClient.signOut();
      throwAuthError(result.error);
    });
  }

  return {
    user,
    infoMessage,
    version,
    isAuthenticated,
    isModerator,
    getSessionEpoch,
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
  };
});

// oxlint-disable no-unnecessary-condition strict-void-return strict-boolean-expressions
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
}
