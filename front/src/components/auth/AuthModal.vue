<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="isForgotPasswordMode ? $t('auth.forgotPasswordTitle') : (isLoginMode ? $t('auth.signIn') : $t('auth.signUp'))"
    :style="{ width: '450px' }"
    class="p-fluid auth-modal-overflow"
    data-testid="auth-modal"
  >
    <!-- AI : Forgot Password Mode -->
    <div v-if="isForgotPasswordMode">
      <p class="text-muted-color mb-4">{{ $t('auth.forgotPasswordMessage') }}</p>

      <form @submit.prevent="handleForgotPassword" class="flex flex-col gap-4" autocomplete="on">
        <div class="field">
          <label
            for="forgot-email"
            class="block text-sm font-medium mb-2"
            >{{ $t('auth.emailAddress') }}</label
          >
          <InputText
            id="forgot-email"
            v-model="forgotPasswordEmail"
            type="email"
            required
            :placeholder="$t('auth.enterEmailAddress')"
            autocomplete="email"
            class="w-full"
            data-testid="forgot-email-input"
          />
        </div>

        <div
          v-if="errorMessage"
          class="p-error flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded"
        >
          <i class="pi pi-exclamation-triangle"></i>
          {{ errorMessage }}
        </div>

        <div
          v-if="resetLinkSent"
          class="p-info flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded"
        >
          <i class="pi pi-info-circle"></i>
          {{ $t('auth.resetLinkSent') }}
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

    <!-- AI : Normal Auth Mode (Sign In / Sign Up) -->
    <div v-else :class="{ 'pt-3': lastLoginMethod === 'google' && isLoginMode }">
      <!-- AI : Social Login Section -->
      <div class="mb-6 overflow-visible">
        <div class="flex flex-col gap-3 mb-4 overflow-visible">
          <div class="relative overflow-visible">
            <Button
              icon="pi pi-google"
              :label="$t('auth.continueWithGoogle')"
              @click="handleOAuthSignIn('google')"
              outlined
              :loading="oauthLoading"
              :disabled="oauthLoading"
              class="w-full"
              :class="{ 'last-used-method': lastLoginMethod === 'google' && isLoginMode }"
            />
            <!-- AI : Last used badge for Google -->
            <span
              v-if="lastLoginMethod === 'google' && isLoginMode"
              class="absolute top-0 -right-1 translate-y-[-33%] text-xs px-3 py-1.5 rounded-full font-semibold z-50"
              style="background-color: var(--p-primary-color); color: var(--p-primary-contrast-color); box-shadow: var(--p-button-shadow);"
              :title="$t('auth.lastUsedGoogle')"
            >
              {{ $t('auth.lastUsed') }}
            </span>
          </div>
        </div>

        <div class="flex items-center my-4">
          <div class="flex-1 border-t border-surface-300"></div>
          <span class="px-3 text-sm text-muted-color">{{ $t('auth.orContinueWithEmail') }}</span>
          <div class="flex-1 border-t border-surface-300"></div>
        </div>
      </div>

      <form @submit.prevent="handleSubmit" class="flex flex-col gap-4" autocomplete="on">
        <div class="field relative">
          <label
            for="auth-email"
            class="block text-sm font-medium mb-2"
            >{{ $t('auth.emailAddress') }}</label
          >
          <InputText
            id="auth-email"
            v-model="form.email"
            type="email"
            required
            :invalid="!!emailError"
            :placeholder="$t('auth.enterEmailAddress')"
            autocomplete="email"
            class="w-full"
            :class="{ 'last-used-input': lastLoginMethod === 'email' && isLoginMode }"
            data-testid="auth-email-input"
          />
          <!-- AI : Last used badge for email method -->
          <span
            v-if="lastLoginMethod === 'email' && isLoginMode && form.email"
            class="absolute top-[1.875rem] -right-1 translate-y-[-33%] text-xs px-3 py-1.5 rounded-full font-semibold z-50"
            style="background-color: var(--p-primary-color); color: var(--p-primary-contrast-color); box-shadow: var(--p-button-shadow);"
            :title="$t('auth.lastUsedEmail')"
          >
            {{ $t('auth.lastUsed') }}
          </span>
          <small v-if="emailError" class="p-error">{{ emailError }}</small>
        </div>

        <div class="field">
          <div class="flex justify-between items-center mb-2">
            <label
              for="auth-password"
              class="block text-sm font-medium"
              >{{ $t('auth.password') }}</label
            >
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
            id="auth-password"
            v-model="form.password"
            :feedback="!isLoginMode"
            toggleMask
            required
            :invalid="!!passwordError"
            :placeholder="isLoginMode ? $t('auth.enterPassword') : $t('auth.chooseStrongPassword')"
            :inputProps="{ autocomplete: isLoginMode ? 'current-password' : 'new-password' }"
            data-testid="auth-password-input"
          />
          <small v-if="passwordError" class="p-error">{{ passwordError }}</small>
        </div>

        <div v-if="!isLoginMode" class="field">
          <label for="auth-username" class="block text-sm font-medium mb-2">
            {{ $t('auth.username') }}
          </label>
          <InputText
            id="auth-username"
            v-model="form.username"
            :placeholder="$t('auth.chooseUsername')"
            autocomplete="nickname"
            class="w-full"
            required
            data-testid="auth-username-input"
          />
          <small class="text-muted-color text-xs">{{ $t('auth.displayName') }}</small>
        </div>

        <!-- AI : Remember Me Checkbox (only in login mode) -->
        <div v-if="isLoginMode" class="field-checkbox flex items-center gap-2">
          <Checkbox
            id="auth-remember-me"
            v-model="form.rememberMe"
            :binary="true"
            data-testid="auth-remember-me"
          />
          <label for="auth-remember-me" class="text-sm cursor-pointer select-none">
            {{ $t('auth.rememberMe') }}
            <span class="text-muted-color text-xs ml-1">({{ $t('auth.rememberMeHint') }})</span>
          </label>
        </div>

        <!-- AI : CAPTCHA Widget (only for registration) -->
        <div v-if="!isLoginMode" class="field flex justify-center py-2">
          <div id="turnstile-widget"></div>
        </div>

        <div
          v-if="errorMessage"
          class="p-error flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded"
        >
          <i class="pi pi-exclamation-triangle"></i>
          {{ errorMessage }}
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

          <div class="text-center pt-3 border-t border-surface-300">
            <span class="text-sm text-muted-color">
              {{ isLoginMode ? $t('auth.dontHaveAccount') : $t('auth.alreadyHaveAccount') }}
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
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/authStore'
import { useToast } from '@/composables/ui/useToast'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
}>()

const { t: $t } = useI18n()
const authStore = useAuthStore()
const toast = useToast()

const isLoginMode = ref(true)
const isForgotPasswordMode = ref(false)
const loading = ref(false)
const oauthLoading = ref(false)
const errorMessage = ref('')
const emailError = ref('')
const passwordError = ref('')
const forgotPasswordEmail = ref('')
const resetLinkSent = ref(false)
const captchaToken = ref('')
const turnstileWidgetId = ref<string | null>(null)

// AI : Track last login method hint
const lastLoginMethod = ref<'email' | 'google' | null>(null)

const visible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
})

const form = reactive({
  email: '',
  password: '',
  username: '',
  rememberMe: false
})

// AI : Watch email field to show last login hint
watch(() => form.email, (email) => {
  if (email && isLoginMode.value && !isForgotPasswordMode.value) {
    lastLoginMethod.value = authStore.getLastLoginMethod(email)
  } else {
    lastLoginMethod.value = null
  }
})

// AI : Reset loading states and errors when modal opens/closes
watch(() => props.visible, (isVisible) => {
  if (isVisible) {
    // AI : Reset all state when modal opens
    oauthLoading.value = false
    loading.value = false
    errorMessage.value = ''
  } else {
    // AI : Clean up when modal closes
    oauthLoading.value = false
    loading.value = false
  }

  // AI : Handle Turnstile rendering when modal opens or mode changes
  if (isVisible && !isLoginMode.value) {
    nextTick(() => renderTurnstile())
  }
})

// AI : Watch mode switch to render/reset Turnstile
watch(isLoginMode, (isLogin) => {
  if (!isLogin && props.visible) {
    nextTick(() => renderTurnstile())
  } else {
    resetTurnstile()
  }
})

// AI : Cloudflare Turnstile Integration
function renderTurnstile() {
  // AI : Check if globalThis.turnstile is available (loaded from index.html)
  if (globalThis.turnstile && document.getElementById('turnstile-widget')) {
    // AI : Reset if already rendered to avoid duplicates
    if (turnstileWidgetId.value) {
      globalThis.turnstile.remove(turnstileWidgetId.value)
    }

    // AI : Get site key from env (Vite exposes env vars via import.meta.env)
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
    if (!siteKey) {
      console.warn('AI: Missing VITE_TURNSTILE_SITE_KEY, CAPTCHA will be skipped in dev')
      return // Skip rendering if no key (dev mode)
    }

    turnstileWidgetId.value = globalThis.turnstile.render('#turnstile-widget', {
      sitekey: siteKey,
      callback: (token: string) => {
        captchaToken.value = token
      },
      'expired-callback': () => {
        captchaToken.value = ''
      },
      theme: 'auto'
    })
  }
}

function resetTurnstile() {
  if (globalThis.turnstile && turnstileWidgetId.value) {
    globalThis.turnstile.remove(turnstileWidgetId.value)
    turnstileWidgetId.value = null
  }
  captchaToken.value = ''
}

// AI : Helper to translate error messages (handles both i18n keys and plain text)
function translateError(errorMessage: string | null | undefined): string {
  if (!errorMessage) return ''

  // AI : Check if it looks like an i18n key (contains dots and starts with 'auth.')
  if (errorMessage.startsWith('auth.')) {
    // AI : Try to translate, fallback to original if key doesn't exist
    const translated = $t(errorMessage)
    return translated !== errorMessage ? translated : errorMessage
  }

  // AI : Return as-is for non-i18n error messages
  return errorMessage
}

function resetForm() {
  form.email = ''
  form.password = ''
  form.username = ''
  form.rememberMe = false
  errorMessage.value = ''
  emailError.value = ''
  passwordError.value = ''
  forgotPasswordEmail.value = ''
  resetLinkSent.value = false
  resetTurnstile()
}

function toggleMode() {
  isLoginMode.value = !isLoginMode.value
  errorMessage.value = ''
  emailError.value = ''
  passwordError.value = ''
}

function showForgotPassword() {
  isForgotPasswordMode.value = true
  errorMessage.value = ''
  resetLinkSent.value = false
  forgotPasswordEmail.value = form.email
}

async function handleSubmit() {
  loading.value = true
  errorMessage.value = ''
  emailError.value = ''
  passwordError.value = ''

  try {
    if (isLoginMode.value) {
      const result = await authStore.signIn(form.email, form.password, form.rememberMe)
      if (result.success) {
        toast.add({ severity: 'success', summary: $t('common.success'), detail: $t('auth.success.loggedIn'), life: 3000 })
        visible.value = false
        resetForm()
      } else {
        errorMessage.value = translateError(result.error) || $t('auth.error.loginFailed')
      }
    } else {
      // AI : Pass captcha token
      const result = await authStore.signUp(form.email, form.password, form.username, captchaToken.value)
      if (result.success) {
        toast.add({ severity: 'success', summary: $t('common.success'), detail: $t('auth.success.registered'), life: 3000 })
        visible.value = false
        resetForm()
      } else {
        errorMessage.value = translateError(result.error) || $t('auth.error.registrationFailed')
        // AI : Reset captcha on failure
        if (globalThis.turnstile && turnstileWidgetId.value) {
          globalThis.turnstile.reset(turnstileWidgetId.value)
          captchaToken.value = ''
        }
      }
    }
  } catch (error) {
    errorMessage.value = translateError(error instanceof Error ? error.message : null) || $t('common.error')
  } finally {
    loading.value = false
  }
}

// AI : Handle OAuth sign in
async function handleOAuthSignIn(provider: 'google') {
  oauthLoading.value = true
  errorMessage.value = ''

  try {
    const result = await authStore.signInWithOAuth(provider, form.rememberMe)
    if (result.success) {
      toast.add({
        severity: 'success',
        summary: $t('common.success'),
        detail: $t('auth.success.googleAuthSuccess'),
        life: 3000
      })
      visible.value = false
      resetForm()
    } else {
      errorMessage.value = translateError(result.error) || $t('auth.error.googleAuthFailed')
    }
  } catch (error) {
    console.error('AI: OAuth sign in error:', error)
    errorMessage.value = translateError(error instanceof Error ? error.message : null) || $t('common.error')
  } finally {
    // AI : Always reset loading state to prevent modal from being stuck in disabled state
    oauthLoading.value = false
  }
}

// AI : Handle forgot password request
async function handleForgotPassword() {
  loading.value = true
  errorMessage.value = ''
  resetLinkSent.value = false

  try {
    const result = await authStore.requestPasswordReset(forgotPasswordEmail.value)
    if (result.success) {
      resetLinkSent.value = true
      toast.add({
        severity: 'info',
        summary: $t('auth.checkYourEmail'),
        detail: $t('auth.resetLinkSent'),
        life: 5000
      })
    } else {
      errorMessage.value = translateError(result.error) || $t('common.error')
    }
  } catch (error) {
    errorMessage.value = translateError(error instanceof Error ? error.message : null) || $t('common.error')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
/* AI : Allow overflow for badges to appear above dialog content */
.auth-modal-overflow :deep(.p-dialog-content) {
  overflow: visible !important;
  padding-top: 1.5rem !important;
}

.auth-modal-overflow :deep(.p-dialog-header) {
  overflow: visible !important;
}
</style>

<style scoped>
/* AI : Highlight last used login method with border color using PrimeVue tokens */
.last-used-method {
  border: 1px solid var(--p-primary-color) !important;
  box-shadow: 0 0 0 2px var(--p-primary-50) !important;
}

.last-used-input {
  border: 1px solid var(--p-primary-color) !important;
  box-shadow: 0 0 0 2px var(--p-primary-50) !important;
}
</style>
