<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="
      screen === 'registered'
        ? $t('auth.verifyEmailTitle')
        : isForgotPasswordMode
          ? $t('auth.forgotPasswordTitle')
          : isLoginMode
            ? $t('auth.signIn')
            : $t('auth.signUp')
    "
    :style="{ width: '450px' }"
    class="auth-modal-overflow"
  >
    <div v-if="screen === 'registered' || screen === 'reset-sent'" class="flex flex-col gap-4">
      <InlineBanner severity="info">
        {{ $t(screen === "registered" ? "auth.verifyEmailMessage" : "auth.resetLinkSent") }}
      </InlineBanner>
      <Button :label="$t('auth.backToSignIn')" link @click="showScreen('login')" />
    </div>

    <div v-else-if="isForgotPasswordMode">
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
            @click="showScreen('login')"
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
              @click="handleOAuthSignIn('osm')"
              outlined
              :loading="oauthLoading"
              :disabled="busy"
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
            :disabled="busy"
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
        <div class="relative">
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
          <small v-if="emailError" class="text-red-600 dark:text-red-400 text-[13px]">{{
            emailError
          }}</small>
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
          <small v-if="usernameError" class="text-red-600 dark:text-red-400 text-[13px]">{{
            usernameError
          }}</small>
          <small v-else class="text-muted-color text-[13px]">{{ $t("auth.displayName") }}</small>
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
              size="small"
              @click="showForgotPassword"
              :disabled="busy"
              class="p-0"
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
          <small v-if="passwordError" class="text-red-600 dark:text-red-400 text-[13px]">{{
            passwordError
          }}</small>
        </div>

        <!-- Remember Me Checkbox (only in login mode) -->
        <div v-if="isLoginMode" class="flex items-center gap-2">
          <Checkbox inputId="auth-remember-me" v-model="form.rememberMe" :binary="true" />
          <label for="auth-remember-me" class="text-sm cursor-pointer select-none">
            {{ $t("auth.rememberMe") }}
            <span class="text-muted-color text-[13px] ml-1">
              ({{ $t("auth.rememberMeHint") }})
            </span>
          </label>
        </div>

        <!-- CAPTCHA Widget (only for registration) -->
        <div v-if="!isLoginMode" class="flex justify-center py-2">
          <div ref="captchaContainer"></div>
        </div>

        <InlineBanner v-if="errorMessage" severity="error">{{ errorMessage }}</InlineBanner>

        <div class="flex flex-col gap-3 mt-2">
          <Button
            type="submit"
            :label="isLoginMode ? $t('auth.signIn') : $t('auth.createAccount')"
            :loading="loading"
            :disabled="busy"
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
              :disabled="busy"
              class="ml-1 p-0"
            />
          </div>
        </div>
      </form>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, shallowRef, reactive, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";
import { loadProviderScript } from "@/services/auth/providerScript";
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

type Screen = "login" | "signup" | "forgot" | "registered" | "reset-sent";
const screen = ref<Screen>(props.initialMode ?? "login");
const isLoginMode = computed(() => screen.value === "login");
const isForgotPasswordMode = computed(
  () => screen.value === "forgot" || screen.value === "reset-sent",
);
type RequestKind = "password" | "google" | "osm";
const request = shallowRef<{ kind: RequestKind; owner: AbortController } | null>(null);
const busy = computed(() => request.value !== null);
const loading = computed(() => request.value?.kind === "password");
const oauthLoading = computed(
  () => request.value?.kind === "google" || request.value?.kind === "osm",
);
const errorMessage = ref("");
const emailError = ref("");
const passwordError = ref("");
const usernameError = ref("");
const forgotPasswordEmail = ref("");
const captchaContainer = ref<HTMLElement | null>(null);
let captchaToken = "";
let turnstileWidgetId: string | null = null;
let captchaGeneration = 0;

function beginRequest(kind: RequestKind) {
  if (busy.value || !props.visible) return null;
  const owner = new AbortController();
  request.value = { kind, owner };
  errorMessage.value = "";
  return owner;
}

function ownsRequest(owner: AbortController) {
  return request.value?.owner === owner && !owner.signal.aborted;
}

function finishRequest(owner: AbortController) {
  if (!ownsRequest(owner)) return;
  request.value = null;
}

function retireRequest() {
  request.value?.owner.abort();
  request.value = null;
}

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

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      resetForm();
      screen.value = props.initialMode ?? "login";
      lastUsed.value = authStore.getLastUsedMethod();
    } else {
      retireRequest();
    }
  },
  { immediate: true },
);

watch(
  [() => props.visible, screen],
  async ([isVisible, currentScreen]) => {
    resetTurnstile();
    if (!isVisible || currentScreen !== "signup") return;
    const generation = captchaGeneration;
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!siteKey) return;
    try {
      await nextTick();
      await loadProviderScript(
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
        () => Boolean(globalThis.turnstile),
      );
      if (generation !== captchaGeneration || !captchaContainer.value) return;
      turnstileWidgetId =
        globalThis.turnstile?.render(captchaContainer.value, {
          sitekey: siteKey,
          callback: (token: string) => {
            if (generation === captchaGeneration) captchaToken = token;
          },
          "expired-callback": () => {
            if (generation === captchaGeneration) captchaToken = "";
          },
          "error-callback": () => {
            if (generation === captchaGeneration) captchaToken = "";
          },
          theme: "auto",
        }) ?? null;
    } catch (error) {
      if (generation === captchaGeneration) {
        errorMessage.value = error instanceof Error ? error.message : $t("common.error");
      }
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  retireRequest();
  resetTurnstile();
});

function resetTurnstile() {
  captchaGeneration += 1;
  if (turnstileWidgetId !== null) globalThis.turnstile?.remove(turnstileWidgetId);
  turnstileWidgetId = null;
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
  resetTurnstile();
}

function showScreen(next: Screen) {
  if (busy.value) return;
  screen.value = next;
  errorMessage.value = "";
  emailError.value = "";
  passwordError.value = "";
  usernameError.value = "";
}

function toggleMode() {
  showScreen(isLoginMode.value ? "signup" : "login");
}

function showForgotPassword() {
  showScreen("forgot");
  forgotPasswordEmail.value = form.email;
}

async function handleSubmit() {
  const owner = beginRequest("password");
  if (!owner) return;
  emailError.value = "";
  passwordError.value = "";
  usernameError.value = "";

  try {
    if (isLoginMode.value) {
      const result = await authStore.signIn(form.email, form.password, form.rememberMe);
      if (!ownsRequest(owner)) return;
      if (result.success) {
        visible.value = false;
        resetForm();
      } else {
        errorMessage.value = translateError(result.error) || $t("auth.error.loginFailed");
      }
    } else {
      const result = await authStore.signUp(form.email, form.password, form.username, captchaToken);
      if (!ownsRequest(owner)) return;
      if (result.success) {
        screen.value = "registered";
        form.password = "";
        errorMessage.value = "";
      } else {
        if (result.error === "auth.error.usernameTaken") {
          usernameError.value = $t("auth.error.usernameTaken");
        } else {
          errorMessage.value = translateError(result.error) || $t("auth.error.registrationFailed");
        }
        if (globalThis.turnstile && turnstileWidgetId !== null) {
          globalThis.turnstile.reset(turnstileWidgetId);
          captchaToken = "";
        }
      }
    }
  } finally {
    finishRequest(owner);
  }
}

async function handleOAuthSignIn(provider: "google" | "osm") {
  const owner = beginRequest(provider);
  if (!owner) return;
  try {
    const result = await authStore.signInWithOAuth(provider);
    if (!ownsRequest(owner)) return;
    if (!result.success) {
      errorMessage.value = translateError(result.error) || $t("auth.error.googleAuthFailed");
    }
  } finally {
    finishRequest(owner);
  }
}

async function handleForgotPassword() {
  const owner = beginRequest("password");
  if (!owner) return;

  try {
    const result = await authStore.requestPasswordReset(forgotPasswordEmail.value);
    if (!ownsRequest(owner)) return;
    if (result.success) {
      screen.value = "reset-sent";
    } else {
      errorMessage.value = translateError(result.error) || $t("common.error");
    }
  } finally {
    finishRequest(owner);
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
