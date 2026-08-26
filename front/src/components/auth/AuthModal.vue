<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="
      isForgotPasswordMode
        ? $t('auth.forgotPasswordTitle')
        : isLoginMode
          ? $t('auth.signIn')
          : $t('auth.signUp')
    "
    :style="{ width: '450px' }"
    class="p-fluid auth-modal-overflow"
  >
    <!-- Forgot Password Mode -->
    <div v-if="isForgotPasswordMode">
      <p class="text-muted-color mb-4">
        {{ $t("auth.forgotPasswordMessage") }}
      </p>

      <form @submit.prevent="handleForgotPassword" class="flex flex-col gap-4" autocomplete="on">
        <div>
          <label for="forgot-email" class="block text-sm font-medium mb-2">{{
            $t("auth.emailAddress")
          }}</label>
          <!-- @vue-expect-error PrimeVue v-model type mismatch -->
          <InputText
            id="forgot-email"
            v-model="forgotPasswordEmail"
            type="email"
            required
            autocomplete="email"
            class="w-full"
          />
        </div>

        <InlineBanner v-if="errorMessage" severity="error">{{ errorMessage }}</InlineBanner>

        <InlineBanner v-if="resetLinkSent" severity="info">
          {{ $t("auth.resetLinkSent") }}
        </InlineBanner>

        <div class="flex flex-col gap-3 mt-2">
          <Button
            type="submit"
            :label="$t('auth.sendResetLink')"
            :loading="loading"
            :disabled="loading"
            class="w-full"
          />

          <Button
            type="button"
            :label="$t('auth.backToSignIn')"
            link
            @click="isForgotPasswordMode = false"
            :disabled="loading"
            class="p-0"
          />
        </div>
      </form>
    </div>

    <!-- Normal Auth Mode (Sign In / Sign Up) -->
    <div v-else :class="{ 'pt-3': lastGoogleUsed && isLoginMode }">
      <!-- Social Login Section -->
      <div class="mb-6 overflow-visible">
        <div class="flex flex-col gap-3 mb-4 overflow-visible">
          <div class="relative overflow-visible">
            <Button
              icon="pi pi-map"
              :label="$t('auth.continueWithOpenStreetMap')"
              @click="handleOsmSignIn"
              outlined
              :loading="oauthLoading"
              :disabled="oauthLoading"
              class="w-full"
              :class="{ 'last-used-method': lastOsmUsed && isLoginMode }"
            />
            <LastUsedBadge
              v-if="lastOsmUsed && isLoginMode"
              :title="$t('auth.lastUsedOpenStreetMap')"
            />
          </div>
        </div>

        <div class="relative overflow-visible">
          <Button
            icon="pi pi-google"
            :label="$t('auth.continueWithGoogle')"
            @click="handleOAuthSignIn('google')"
            outlined
            :loading="oauthLoading"
            :disabled="oauthLoading"
            class="w-full"
            :class="{
              'last-used-method': lastGoogleUsed && isLoginMode,
            }"
          />
          <LastUsedBadge v-if="lastGoogleUsed && isLoginMode" :title="$t('auth.lastUsedGoogle')" />
        </div>

        <div class="flex items-center my-4">
          <div class="flex-1 border-t border-surface"></div>
          <span class="px-3 text-sm text-muted-color">{{ $t("auth.orContinueWithEmail") }}</span>
          <div class="flex-1 border-t border-surface"></div>
        </div>
      </div>

      <form @submit.prevent="handleSubmit" class="flex flex-col gap-4" autocomplete="on">
        <div class="field relative">
          <label for="auth-email" class="block text-sm font-medium mb-2">{{
            $t("auth.emailAddress")
          }}</label>
          <!-- @vue-expect-error PrimeVue v-model type mismatch -->
          <InputText
            id="auth-email"
            v-model="form.email"
            type="email"
            required
            :invalid="Boolean(emailError)"
            autocomplete="email"
            class="w-full"
            :class="{
              'last-used-input': lastEmailUsed && isLoginMode,
            }"
          />
          <LastUsedBadge
            v-if="lastEmailUsed && isLoginMode"
            :title="$t('auth.lastUsedEmail')"
            top="top-7.5"
          />
          <small v-if="emailError" class="p-error">{{ emailError }}</small>
        </div>

        <div v-if="!isLoginMode">
          <label for="auth-username" class="block text-sm font-medium mb-2">
            {{ $t("auth.username") }}
          </label>
          <!-- @vue-expect-error PrimeVue v-model type mismatch -->
          <InputText
            id="auth-username"
            v-model="form.username"
            autocomplete="nickname"
            class="w-full"
            required
            :invalid="Boolean(usernameError)"
            dir="auto"
          />
          <small v-if="usernameError" class="p-error">{{ usernameError }}</small>
          <small v-else class="text-muted-color text-xs">{{ $t("auth.displayName") }}</small>
        </div>

        <div>
          <div class="flex justify-between items-center mb-2">
            <label for="auth-password" class="block text-sm font-medium">{{
              $t("auth.password")
            }}</label>
            <Button
              v-if="isLoginMode"
              type="button"
              :label="$t('auth.forgotPassword')"
              link
              @click="showForgotPassword"
              :disabled="loading || oauthLoading"
              class="p-0 text-xs"
            />
          </div>
          <Password
            inputId="auth-password"
            v-model="form.password"
            :feedback="!isLoginMode"
            toggleMask
            required
            fluid
            :invalid="Boolean(passwordError)"
            :inputProps="{
              autocomplete: isLoginMode ? 'current-password' : 'new-password',
            }"
          />
          <small v-if="passwordError" class="p-error">{{ passwordError }}</small>
        </div>

        <!-- Remember Me Checkbox (only in login mode) -->
        <div v-if="isLoginMode" class="field-checkbox flex items-center gap-2">
          <Checkbox inputId="auth-remember-me" v-model="form.rememberMe" :binary="true" />
          <label for="auth-remember-me" class="text-sm cursor-pointer select-none">
            {{ $t("auth.rememberMe") }}
            <span class="text-muted-color text-xs ml-1">({{ $t("auth.rememberMeHint") }})</span>
          </label>
        </div>

        <!-- CAPTCHA Widget (only for registration) -->
        <div v-if="!isLoginMode" class="field flex justify-center py-2">
          <div id="turnstile-widget"></div>
        </div>

        <InlineBanner v-if="errorMessage" severity="error">{{ errorMessage }}</InlineBanner>

        <!-- Registration success message -->
        <div
          v-if="registrationSuccess && !isLoginMode"
          class="flex flex-col gap-2 p-3 bg-blue-50 border border-blue-200 rounded dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200"
        >
          <div class="flex items-center gap-2 font-semibold text-blue-700 dark:text-blue-200">
            <i class="pi pi-info-circle"></i>
            {{ $t("auth.verifyEmailTitle") }}
          </div>
          <p class="text-sm text-blue-600 dark:text-blue-200 m-0">
            {{ $t("auth.verifyEmailMessage") }}
          </p>
        </div>

        <div class="flex flex-col gap-3 mt-2">
          <Button
            type="submit"
            :label="isLoginMode ? $t('auth.signIn') : $t('auth.createAccount')"
            :loading="loading"
            :disabled="loading || oauthLoading"
            class="w-full"
          />

          <div class="text-center pt-3 border-t border-surface">
            <span class="text-sm text-muted-color">
              {{ isLoginMode ? $t("auth.dontHaveAccount") : $t("auth.alreadyHaveAccount") }}
            </span>
            <Button
              type="button"
              :label="isLoginMode ? $t('auth.signUp') : $t('auth.signIn')"
              link
              @click="toggleMode"
              :disabled="loading || oauthLoading"
              class="ml-1 p-0"
            />
          </div>
        </div>
      </form>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { toastSuccess, toastInfo } from "@/services/core/toast";

import { ref, reactive, computed, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";
import LastUsedBadge from "@/components/auth/LastUsedBadge.vue";
import InlineBanner from "@/components/common/InlineBanner.vue";

const props = defineProps<{
  visible: boolean;
  initialMode?: "login" | "signup";
}>();

const emit = defineEmits<{
  "update:visible": [visible: boolean];
}>();

const { t: $t } = useI18n();
const authStore = useAuthStore();

const isLoginMode = ref(props.initialMode !== "signup");
const isForgotPasswordMode = ref(false);
const loading = ref(false);
const oauthLoading = ref(false);
const errorMessage = ref("");
const emailError = ref("");
const passwordError = ref("");
const usernameError = ref("");
const forgotPasswordEmail = ref("");
const resetLinkSent = ref(false);
const registrationSuccess = ref(false);
let captchaToken = "";
let turnstileWidgetId: string | null = null;

// Single "last used" sign-in hint, read when the modal opens.
const lastUsed = ref<{ method: "email" | "google" | "osm"; email: string | null } | null>(null);

const visible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit("update:visible", value),
});

const form = reactive({
  email: "",
  password: "",
  username: "",
  rememberMe: false,
});

// The email badge also requires the typed email to match the recorded one.
const lastEmailUsed = computed(
  () =>
    lastUsed.value?.method === "email" &&
    Boolean(form.email) &&
    form.email === lastUsed.value.email,
);
const lastGoogleUsed = computed(() => lastUsed.value?.method === "google");
const lastOsmUsed = computed(() => lastUsed.value?.method === "osm");

// Reset loading states and errors when modal opens/closes
watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      oauthLoading.value = false;
      loading.value = false;
      errorMessage.value = "";
      lastUsed.value = authStore.getLastUsedMethod();
    } else {
      oauthLoading.value = false;
      loading.value = false;
    }

    // Handle Turnstile rendering when modal opens or mode changes
    if (isVisible && !isLoginMode.value) {
      nextTick().then(() => renderTurnstile());
    }
  },
  // The modal is v-if-mounted only once already visible, so the initial true value
  // must be handled here or the "last used" hint is never read.
  { immediate: true },
);

// Watch mode switch to render/reset Turnstile
watch(isLoginMode, (isLogin) => {
  if (!isLogin && props.visible) {
    nextTick().then(() => renderTurnstile());
  } else {
    resetTurnstile();
  }
});

// Lazily inject the Turnstile script the first time signup mode is shown
function loadTurnstileScript(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (globalThis.turnstile) {
      resolve();
      return;
    }

    const existing = document.querySelector(
      'script[src^="https://challenges.cloudflare.com/turnstile"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Turnstile")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Failed to load Turnstile")));
    document.head.appendChild(script);
  });
}

// Cloudflare Turnstile Integration
async function renderTurnstile() {
  await loadTurnstileScript();

  if (globalThis.turnstile && document.querySelector("#turnstile-widget")) {
    // Reset if already rendered to avoid duplicates
    if (turnstileWidgetId) {
      globalThis.turnstile.remove(turnstileWidgetId);
    }

    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!siteKey) {
      console.warn("Missing VITE_TURNSTILE_SITE_KEY, CAPTCHA will be skipped in dev");
      return; // Skip rendering if no key (dev mode)
    }

    turnstileWidgetId = globalThis.turnstile.render("#turnstile-widget", {
      sitekey: siteKey,
      callback: (token: string) => {
        captchaToken = token;
      },
      "expired-callback": () => {
        captchaToken = "";
      },
      theme: "auto",
    });
  }
}

function resetTurnstile() {
  if (globalThis.turnstile && turnstileWidgetId) {
    globalThis.turnstile.remove(turnstileWidgetId);
    turnstileWidgetId = null;
  }
  captchaToken = "";
}

// Helper to translate error messages (handles both i18n keys and plain text)
function translateError(errorKey: string | null | undefined): string {
  if (!errorKey) return "";

  // Check if it looks like an i18n key (contains dots and starts with 'auth.')
  if (errorKey.startsWith("auth.")) {
    // Try to translate, fallback to original if key doesn't exist
    const translated = $t(errorKey);
    return translated !== errorKey ? translated : errorKey;
  }

  // Return as-is for non-i18n error messages
  return errorKey;
}

function resetForm() {
  form.email = "";
  form.password = "";
  form.username = "";
  form.rememberMe = false;
  errorMessage.value = "";
  emailError.value = "";
  passwordError.value = "";
  usernameError.value = "";
  forgotPasswordEmail.value = "";
  resetLinkSent.value = false;
  registrationSuccess.value = false;
  resetTurnstile();
}

function toggleMode() {
  isLoginMode.value = !isLoginMode.value;
  errorMessage.value = "";
  emailError.value = "";
  passwordError.value = "";
  usernameError.value = "";
  registrationSuccess.value = false;
}

function showForgotPassword() {
  isForgotPasswordMode.value = true;
  errorMessage.value = "";
  resetLinkSent.value = false;
  forgotPasswordEmail.value = form.email;
}

async function handleSubmit() {
  loading.value = true;
  errorMessage.value = "";
  emailError.value = "";
  passwordError.value = "";
  usernameError.value = "";

  try {
    if (isLoginMode.value) {
      const result = await authStore.signIn(form.email, form.password, form.rememberMe);
      if (result.success) {
        toastSuccess($t("auth.success.loggedIn"));
        visible.value = false;
        resetForm();
      } else {
        errorMessage.value = translateError(result.error) || $t("auth.error.loginFailed");
      }
    } else {
      const result = await authStore.signUp(form.email, form.password, form.username, captchaToken);
      if (result.success) {
        registrationSuccess.value = true;
        errorMessage.value = "";
        toastSuccess($t("auth.success.registered"));
      } else {
        if (result.error === "auth.error.usernameTaken") {
          usernameError.value = $t("auth.error.usernameTaken");
        } else {
          errorMessage.value = translateError(result.error) || $t("auth.error.registrationFailed");
        }
        if (globalThis.turnstile && turnstileWidgetId) {
          globalThis.turnstile.reset(turnstileWidgetId);
          captchaToken = "";
        }
      }
    }
  } finally {
    loading.value = false;
  }
}

function handleOsmSignIn() {
  oauthLoading.value = true;
  errorMessage.value = "";
  authStore.startOsmLogin(form.rememberMe);
}

async function handleOAuthSignIn(provider: "google") {
  oauthLoading.value = true;
  errorMessage.value = "";

  try {
    const result = await authStore.signInWithOAuth(provider, form.rememberMe);
    if (result.success) {
      toastSuccess($t("auth.success.googleAuthSuccess"));
      visible.value = false;
      resetForm();
    } else {
      errorMessage.value = translateError(result.error) || $t("auth.error.googleAuthFailed");
    }
  } finally {
    oauthLoading.value = false;
  }
}

async function handleForgotPassword() {
  loading.value = true;
  errorMessage.value = "";
  resetLinkSent.value = false;

  try {
    const result = await authStore.requestPasswordReset(forgotPasswordEmail.value);
    if (result.success) {
      resetLinkSent.value = true;
      toastInfo($t("auth.resetLinkSent"), $t("auth.checkYourEmail"));
    } else {
      errorMessage.value = translateError(result.error) || $t("common.error");
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
/* Allow overflow for badges to appear above dialog content */
.auth-modal-overflow :deep(.p-dialog-content) {
  overflow: visible !important;
  padding-top: 1.5rem !important;
}

.auth-modal-overflow :deep(.p-dialog-header) {
  overflow: visible !important;
}

/* Highlight last used login method with border color using PrimeVue tokens */
.last-used-method,
.last-used-input {
  border: 1px solid var(--p-primary-color) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-primary-color) 20%, transparent) !important;
}
</style>
