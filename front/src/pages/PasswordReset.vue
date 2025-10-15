<template>
  <div class="reset-container">
    <div class="reset-card">
      <div v-if="loading" class="loading-state">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem; color: var(--p-primary-color);"></i>
        <p>{{ $t('common.loading') }}</p>
      </div>

      <div v-else-if="tokenValid" class="form-state">
        <i class="pi pi-key" style="font-size: 3rem; color: var(--p-primary-color);"></i>
        <h2>{{ $t('auth.resetPasswordTitle') }}</h2>
        <form @submit.prevent="handleResetPassword" class="reset-form">
          <div class="field">
            <label for="password">{{ $t('auth.newPassword') }}</label>
            <Password
              id="password"
              v-model="newPassword"
              :feedback="true"
              toggleMask
              :placeholder="$t('auth.chooseStrongPassword')"
              :class="{ 'p-invalid': passwordError }"
              required
            />
            <small v-if="passwordError" class="p-error">{{ passwordError }}</small>
          </div>

          <div class="field">
            <label for="confirmPassword">{{ $t('auth.confirmPassword') }}</label>
            <Password
              id="confirmPassword"
              v-model="confirmPassword"
              :feedback="false"
              toggleMask
              :placeholder="$t('auth.confirmPassword')"
              :class="{ 'p-invalid': confirmError }"
              required
            />
            <small v-if="confirmError" class="p-error">{{ confirmError }}</small>
          </div>

          <Button
            type="submit"
            :label="$t('auth.resetPassword')"
            :loading="submitting"
            :disabled="!isFormValid"
            class="w-full"
          />
        </form>
      </div>

      <div v-else class="error-state">
        <i class="pi pi-times-circle" style="font-size: 3rem; color: var(--p-red-500);"></i>
        <h2>{{ $t('auth.invalidResetToken') }}</h2>
        <p>{{ errorMessage }}</p>
        <Button @click="goToApp" :label="$t('auth.backToSignIn')" severity="secondary" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@stores/authStore'
import { useToast } from '@composables/ui/useToast'

const { t: $t } = useI18n()

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const toast = useToast()

const loading = ref(true)
const tokenValid = ref(false)
const submitting = ref(false)
const newPassword = ref('')
const confirmPassword = ref('')
const passwordError = ref('')
const confirmError = ref('')
const errorMessage = ref('')

const isFormValid = computed(() => {
  return newPassword.value.length >= 8 && 
         newPassword.value === confirmPassword.value &&
         !passwordError.value && 
         !confirmError.value
})

function validatePasswords() {
  passwordError.value = ''
  confirmError.value = ''

  if (newPassword.value && newPassword.value.length < 8) {
    passwordError.value = $t('auth.chooseStrongPassword')
  }

  if (confirmPassword.value && newPassword.value !== confirmPassword.value) {
    confirmError.value = $t('auth.passwordsDontMatch')
  }
}

async function validateToken() {
  try {
    const token = route.query.token as string

    if (!token) {
      throw new Error($t('auth.invalidResetToken'))
    }

    tokenValid.value = true
  } catch (error) {
    console.error('Token validation failed:', error)
    errorMessage.value = error instanceof Error ? error.message : $t('auth.invalidResetToken')
  } finally {
    loading.value = false
  }
}

async function handleResetPassword() {
  try {
    validatePasswords()
    if (!isFormValid.value) return

    submitting.value = true
    const token = route.query.token as string

    const result = await authStore.resetPassword(token, newPassword.value)

    if (result.success) {
      toast.add({
        severity: 'success',
        summary: $t('common.success'),
        detail: $t('auth.passwordResetSuccess'),
        life: 3000
      })

      router.push('/')
    } else {
      throw new Error(result.error ?? $t('auth.invalidResetToken'))
    }
  } catch (error) {
    console.error('Password reset failed:', error)
    toast.add({
      severity: 'error',
      summary: $t('common.error'),
      detail: error instanceof Error ? error.message : $t('auth.invalidResetToken'),
      life: 5000
    })
  } finally {
    submitting.value = false
  }
}

function goToApp() {
  router.push('/')
}

onMounted(() => {
  validateToken()
})
</script>

<style scoped>
.reset-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, var(--p-primary-50), var(--p-primary-100));
  padding: 20px;
}

.reset-card {
  background: white;
  padding: 3rem;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  text-align: center;
  max-width: 400px;
  width: 100%;
}

.loading-state,
.form-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.reset-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: left;
}

.field label {
  font-weight: 500;
  color: var(--p-text-color);
}

h2 {
  margin: 0;
  color: var(--p-text-color);
  font-size: 1.5rem;
}

p {
  margin: 0;
  color: var(--p-text-muted-color);
  line-height: 1.5;
}
</style>