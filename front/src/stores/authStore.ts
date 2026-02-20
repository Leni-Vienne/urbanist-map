import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import { trpc } from "@/client";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";

// AI : User type for our custom authentication
interface User {
  id: string;
  email: string;
  username: string | null;
  role: string | null;
  moderatedCountries: string[] | null; // AI : Array of ISO 3-letter country codes (null = admin with all countries)
  emailVerified: boolean;
}

// AI : Helper function to load Google Identity Services script
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

// AI : Get last login method for a given email (for UX hint)
function getLastLoginMethod(email: string): "email" | "google" | null {
  try {
    const method = localStorage.getItem(`lastLoginMethod:${email}`);
    return method as "email" | "google" | null;
  } catch {
    return null;
  }
}

// AI : Helper function to send Google token to backend
async function sendGoogleTokenToBackend(credential: string, rememberMe: boolean) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/google-login`, {
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

// AI : Helper function to handle successful Google authentication
function handleGoogleAuthSuccess(newUser: User | null) {
  if (newUser?.email) {
    localStorage.setItem(`lastLoginMethod:${newUser.email}`, "google");
  }

  return {
    success: true,
    user: newUser,
    error: null,
  };
}

// AI : Helper function to create Google callback handler
function createGoogleCallbackHandler(
  rememberMe: boolean,
  userRef: { value: User | null },
  resolve: (value: { success: boolean; user: User | null; error: string | null }) => void,
  clearTimeoutFn: () => void,
) {
  return (response: { credential: string }) => {
    clearTimeoutFn();

    // AI : Handle async operations internally to satisfy void return type
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      try {
        const newUser = await sendGoogleTokenToBackend(response.credential, rememberMe);
        userRef.value = newUser;
        resolve(handleGoogleAuthSuccess(newUser));
      } catch (error: unknown) {
        console.error("Google OAuth error:", error);
        resolve({
          success: false,
          user: null,
          error: error instanceof Error ? error.message : "Google authentication failed",
        });
      }
    })();
  };
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const loading = ref(true);
  const infoMessage = ref<string | null>(null);

  // AI : Computed properties
  const isAuthenticated = computed(() => Boolean(user.value));
  // AI : User is a moderator if they're admin OR have moderatedCountries assigned
  const isModerator = computed(
    () =>
      user.value?.role === "admin" ||
      (user.value?.moderatedCountries !== null && user.value?.moderatedCountries !== undefined),
  );

  // AI : Initialize auth state
  async function initialize() {
    try {
      loading.value = true;

      // AI : Try to get current user from server (will use session cookies)
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/check-session`, {
        credentials: "include",
      });

      if (response.ok) {
        const result: { user: User; infoMessage: string | null } = await response.json();
        user.value = result.user;
        infoMessage.value = result.infoMessage;
      } else {
        user.value = null;
        infoMessage.value = null;
      }
    } catch (error) {
      console.error("Error initializing auth:", error);
      user.value = null;
      infoMessage.value = null;
    } finally {
      loading.value = false;
    }
  }

  // AI : Sign up with email and password
  async function signUp(email: string, password: string, username: string, captchaToken?: string) {
    try {
      const result = await trpc.auth.register.mutate({
        email,
        password,
        username,
        captchaToken,
      });

      return {
        success: result.success,
        user: result.user,
        error: result.success ? null : result.message,
      };
    } catch (error: unknown) {
      console.error("Sign up error:", error);
      return {
        success: false,
        user: null,
        error: error instanceof Error ? error.message : "Registration failed",
      };
    }
  }

  // AI : Sign in with email and password
  async function signIn(email: string, password: string, rememberMe = false) {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/login`, {
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
        // AI : Store last login method for UX hint
        if (result.user?.email) {
          localStorage.setItem(`lastLoginMethod:${result.user.email}`, "email");
        }
        return {
          success: true,
          user: result.user ?? null,
          error: null,
        };
      } else {
        return {
          success: false,
          user: null,
          error: result.error ?? result.message ?? "Login failed",
        };
      }
    } catch (error: unknown) {
      console.error("Sign in error:", error);
      return {
        success: false,
        user: null,
        error: error instanceof Error ? error.message : "Login failed",
      };
    }
  }

  // AI : Google OAuth authentication using simple One Tap
  async function signInWithOAuth(
    provider: "google",
    rememberMe = false,
  ): Promise<{ success: boolean; user: User | null; error: string | null }> {
    // AI : Early validation checks
    if (provider !== "google") {
      return {
        success: false,
        user: null,
        error: "Only Google OAuth is currently supported",
      };
    }

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      return {
        success: false,
        user: null,
        error: "Google Client ID not configured",
      };
    }

    try {
      // AI : Load Google Identity Services script if not already loaded
      if (!globalThis.google) {
        await loadGoogleIdentityScript();
      }

      if (!globalThis.google) {
        return {
          success: false,
          user: null,
          error: "Google Identity Services not loaded",
        };
      }

      // AI : Initialize Google OAuth with Promise-based flow
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({
            success: false,
            user: null,
            error: "Google authentication timed out",
          });
        }, 60_000);

        function clearTimeoutFn() {
          clearTimeout(timeout);
        }

        globalThis.google?.accounts.id.initialize({
          client_id: clientId,
          callback: createGoogleCallbackHandler(rememberMe, user, resolve, clearTimeoutFn),
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        // AI : Prompt the user to sign in
        // @ts-ignore - Google Identity Services types may be incomplete
        globalThis.google?.accounts.id.prompt((notification: any) => {
          if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
            clearTimeoutFn();
            resolve({
              success: false,
              user: null,
              error: "Google sign-in was cancelled or not displayed",
            });
          }
        });
      });
    } catch (error: unknown) {
      console.error("Google OAuth error:", error);
      return {
        success: false,
        user: null,
        error: error instanceof Error ? error.message : "Google authentication failed",
      };
    }
  }

  // AI : Sign out
  async function signOut() {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/logout`, {
        method: "POST",
        credentials: "include",
      });

      user.value = null;

      // AI : Clear all state on logout to prevent data leakage between accounts
      const mapStore = useMapStore();
      const projectStore = useProjectStore();
      const overlayStore = useOverlayStore();
      const moderationStore = useModerationStore();

      // AI : Clear map state
      mapStore.clearCityProjectsCache();
      mapStore.clearCityStandaloneProjectsCache();
      mapStore.clearSelectedCity();

      // AI : Clear all project and overlay state
      projectStore.clearAllState();
      overlayStore.clearAllState();
      moderationStore.clearAllState();

      // AI : Clear visual map elements directly (no watcher needed)
      // AI : MOVED TO APP.VUE WATCHER TO AVOID CIRCULAR DEPENDENCY
      // clearMapOnLogout();

      if (response.ok) {
        return { success: true, error: null };
      } else {
        const result: { error?: string } = await response.json();
        return { success: false, error: result.error ?? "Logout failed" };
      }
    } catch (error: unknown) {
      console.error("Sign out error:", error);
      // AI : Clear local data even if server logout fails
      user.value = null;
      return { success: false, error: error instanceof Error ? error.message : "Logout failed" };
    }
  }

  // AI : Verify email
  async function verifyEmail(token: string) {
    try {
      const result = await trpc.auth.verifyEmail.mutate({ token });
      return {
        success: result.success,
        user: result.user ?? null,
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

  // AI : Request password reset
  async function requestPasswordReset(email: string) {
    try {
      const result = await trpc.auth.requestPasswordReset.mutate({ email });
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

  // AI : Reset password
  async function resetPassword(token: string, password: string) {
    try {
      const result = await trpc.auth.resetPassword.mutate({ token, password });
      return {
        success: result.success,
        error: result.success ? null : result.message,
      };
    } catch (error: unknown) {
      console.error("Password reset error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Password reset failed",
      };
    }
  }

  return {
    user,
    loading,
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
    getLastLoginMethod,
  };
});

// AI : Enable HMR for this store
// eslint-disable @typescript-eslint/no-unnecessary-condition @typescript-eslint/strict-void-return
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
}
