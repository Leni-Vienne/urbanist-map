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
    data-testid="auth-modal"
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
          <InputText
            id="forgot-email"
            v-model="forgotPasswordEmail"
            type="email"
            required
            autocomplete="email"
            class="w-full"
            data-testid="forgot-email-input"
          />
        </div>

        <div
          v-if="errorMessage"
          class="p-error flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded dark:bg-red-900/30 dark:border-red-700 dark:text-red-300"
        >
          <i class="pi pi-exclamation-triangle"></i>
          {{ errorMessage }}
        </div>

        <div
          v-if="resetLinkSent"
          class="p-info flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200"
        >
          <i class="pi pi-info-circle"></i>
          {{ $t("auth.resetLinkSent") }}
        </div>

        <div class="flex flex-col gap-3 mt-2">
          <Button
            type="submit"
            :label="$t('auth.sendResetLink')"
            :loading="loading"
            :disabled="loading"
            class="w-full"
            data-testid="send-reset-button"
          />

          <Button
            type="button"
            :label="$t('auth.backToSignIn')"
            link
            @click="isForgotPasswordMode = false"
            :disabled="loading"
            class="p-0"
            data-testid="back-to-signin"
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
            <!-- Last used badge for OpenStreetMap -->
            <span
              v-if="lastOsmUsed && isLoginMode"
              class="absolute top-0 -right-1 translate-y-[-33%] text-xs px-3 py-1.5 rounded-full font-semibold z-50"
              style="
                background-color: var(--p-primary-color);
                color: var(--p-primary-contrast-color);
                box-shadow: var(--p-button-shadow);
              "
              :title="$t('auth.lastUsedOpenStreetMap')"
            >
              {{ $t("auth.lastUsed") }}
            </span>
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
          <!-- Last used badge for Google -->
          <span
            v-if="lastGoogleUsed && isLoginMode"
            class="absolute top-0 -right-1 translate-y-[-33%] text-xs px-3 py-1.5 rounded-full font-semibold z-50"
            style="
              background-color: var(--p-primary-color);
              color: var(--p-primary-contrast-color);
              box-shadow: var(--p-button-shadow);
            "
            :title="$t('auth.lastUsedGoogle')"
          >
            {{ $t("auth.lastUsed") }}
          </span>
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
            data-testid="auth-email-input"
          />
          <!-- Last used badge for email method -->
          <span
            v-if="lastEmailUsed && isLoginMode"
            class="absolute top-7.5 -right-1 translate-y-[-33%] text-xs px-3 py-1.5 rounded-full font-semibold z-50"
            style="
              background-color: var(--p-primary-color);
              color: var(--p-primary-contrast-color);
              box-shadow: var(--p-button-shadow);
            "
            :title="$t('auth.lastUsedEmail')"
          >
            {{ $t("auth.lastUsed") }}
          </span>
          <small v-if="emailError" class="p-error">{{ emailError }}</small>
        </div>

        <div v-if="!isLoginMode">
          <label for="auth-username" class="block text-sm font-medium mb-2">
            {{ $t("auth.username") }}
          </label>
          <InputText
            id="auth-username"
            v-model="form.username"
            autocomplete="nickname"
            class="w-full"
            required
            :invalid="Boolean(usernameError)"
            dir="auto"
            data-testid="auth-username-input"
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
              data-testid="forgot-password-link"
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
            data-testid="auth-password-input"
          />
          <small v-if="passwordError" class="p-error">{{ passwordError }}</small>
        </div>

        <!-- Remember Me Checkbox (only in login mode) -->
        <div v-if="isLoginMode" class="field-checkbox flex items-center gap-2">
          <Checkbox
            inputId="auth-remember-me"
            v-model="form.rememberMe"
            :binary="true"
            data-testid="auth-remember-me"
          />
          <label for="auth-remember-me" class="text-sm cursor-pointer select-none">
            {{ $t("auth.rememberMe") }}
            <span class="text-muted-color text-xs ml-1">({{ $t("auth.rememberMeHint") }})</span>
          </label>
        </div>

        <!-- CAPTCHA Widget (only for registration) -->
        <div v-if="!isLoginMode" class="field flex justify-center py-2">
          <div id="turnstile-widget"></div>
        </div>

        <div
          v-if="errorMessage"
          class="p-error flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded dark:bg-red-900/30 dark:border-red-700 dark:text-red-300"
        >
          <i class="pi pi-exclamation-triangle"></i>
          {{ errorMessage }}
        </div>

        <!-- Registration success message -->
        <div
          v-if="registrationSuccess && !isLoginMode"
          class="flex flex-col gap-2 p-3 bg-blue-50 border border-blue-200 rounded dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200"
        >
          <div class="flex items-center gap-2 font-semibold text-blue-700">
            <i class="pi pi-info-circle"></i>
            {{ $t("auth.verifyEmailTitle") }}
          </div>
          <p class="text-sm text-blue-600 m-0">
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
            data-testid="auth-submit-button"
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
              data-testid="auth-mode-toggle"
            />
          </div>
        </div>
      </form>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";
import { useToast } from "@/composables/ui/useToast";

const props = defineProps<{
  visible: boolean;
  initialMode?: "login" | "signup";
}>();

const emit = defineEmits<{
  "update:visible": [visible: boolean];
}>();

const { t: $t } = useI18n();
const authStore = useAuthStore();
const toast = useToast();

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
const captchaToken = ref("");
const turnstileWidgetId = ref<string | null>(null);

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
      nextTick(() => renderTurnstile());
    }
  },
);

// Watch mode switch to render/reset Turnstile
watch(isLoginMode, (isLogin) => {
  if (!isLogin && props.visible) {
    nextTick(() => renderTurnstile());
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
    if (turnstileWidgetId.value) {
      globalThis.turnstile.remove(turnstileWidgetId.value);
    }

    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!siteKey) {
      console.warn("Missing VITE_TURNSTILE_SITE_KEY, CAPTCHA will be skipped in dev");
      return; // Skip rendering if no key (dev mode)
    }

    turnstileWidgetId.value = globalThis.turnstile.render("#turnstile-widget", {
      sitekey: siteKey,
      callback: (token: string) => {
        captchaToken.value = token;
      },
      "expired-callback": () => {
        captchaToken.value = "";
      },
      theme: "auto",
    });
  }
}

function resetTurnstile() {
  if (globalThis.turnstile && turnstileWidgetId.value) {
    globalThis.turnstile.remove(turnstileWidgetId.value);
    turnstileWidgetId.value = null;
  }
  captchaToken.value = "";
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
        toast.add({
          severity: "success",
          summary: $t("common.success"),
          detail: $t("auth.success.loggedIn"),
          life: 3000,
        });
        visible.value = false;
        resetForm();
      } else {
        errorMessage.value = translateError(result.error) || $t("auth.error.loginFailed");
      }
    } else {
      const result = await authStore.signUp(
        form.email,
        form.password,
        form.username,
        captchaToken.value,
      );
      if (result.success) {
        registrationSuccess.value = true;
        errorMessage.value = "";
        toast.add({
          severity: "success",
          summary: $t("common.success"),
          detail: $t("auth.success.registered"),
          life: 3000,
        });
      } else {
        if (result.error === "auth.error.usernameTaken") {
          usernameError.value = $t("auth.error.usernameTaken");
        } else if (result.error === "auth.error.emailAlreadyExists") {
          emailError.value = $t("auth.error.emailAlreadyExists");
        } else {
          errorMessage.value = translateError(result.error) || $t("auth.error.registrationFailed");
        }
        if (globalThis.turnstile && turnstileWidgetId.value) {
          globalThis.turnstile.reset(turnstileWidgetId.value);
          captchaToken.value = "";
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
      toast.add({
        severity: "success",
        summary: $t("common.success"),
        detail: $t("auth.success.googleAuthSuccess"),
        life: 3000,
      });
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
      toast.add({
        severity: "info",
        summary: $t("auth.checkYourEmail"),
        detail: $t("auth.resetLinkSent"),
        life: 5000,
      });
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
.last-used-method {
  border: 1px solid var(--p-primary-color) !important;
  box-shadow: 0 0 0 2px var(--p-primary-50) !important;
}

.last-used-input {
  border: 1px solid var(--p-primary-color) !important;
  box-shadow: 0 0 0 2px var(--p-primary-50) !important;
}
</style>
