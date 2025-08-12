<template>
  <Dialog 
    v-model:visible="visible" 
    modal 
    :header="isLoginMode ? 'Sign In' : 'Sign Up'" 
    :style="{width: '450px'}" 
    class="p-fluid"
  >
    <!-- AI : Social Login Section -->
    <div class="mb-6">
      <div class="flex flex-col gap-3 mb-4">
        <Button
          icon="pi pi-google"
          label="Continue with Google"
          @click="handleOAuthSignIn('google')"
          outlined
          :loading="oauthLoading"
          :disabled="oauthLoading"
          class="w-full"
        />
        <Button
          icon="pi pi-github"
          label="Continue with GitHub" 
          @click="handleOAuthSignIn('github')"
          outlined
          severity="secondary"
          :loading="oauthLoading"
          :disabled="oauthLoading"
          class="w-full"
        />
      </div>
      
      <div class="flex items-center my-4">
        <div class="flex-1 border-t border-surface-300"></div>
        <span class="px-3 text-sm text-muted-color">or continue with email</span>
        <div class="flex-1 border-t border-surface-300"></div>
      </div>
    </div>

    <form @submit.prevent="handleSubmit" class="flex flex-col gap-4" autocomplete="on">
      <div class="field">
        <label for="auth-email" class="block text-sm font-medium mb-2">Email Address</label>
        <InputText 
          id="auth-email"
          v-model="form.email"
          type="email" 
          required
          :invalid="!!emailError"
          placeholder="Enter your email address"
          autocomplete="email"
          class="w-full"
        />
        <small v-if="emailError" class="p-error">{{ emailError }}</small>
      </div>

      <div class="field">
        <label for="auth-password" class="block text-sm font-medium mb-2">Password</label>
        <Password 
          id="auth-password"
          v-model="form.password"
          :feedback="!isLoginMode"
          toggleMask
          required
          :invalid="!!passwordError"
          :placeholder="isLoginMode ? 'Enter your password' : 'Choose a strong password'"
          :autocomplete="isLoginMode ? 'current-password' : 'new-password'"
        />
        <small v-if="passwordError" class="p-error">{{ passwordError }}</small>
      </div>

      <div v-if="!isLoginMode" class="field">
        <label for="auth-username" class="block text-sm font-medium mb-2">
          Username <span class="text-muted-color text-xs">(optional)</span>
        </label>
        <InputText 
          id="auth-username"
          v-model="form.username"
          placeholder="Choose a username"
          autocomplete="username"
          class="w-full"
        />
        <small class="text-muted-color text-xs">This will be your display name</small>
      </div>

      <div v-if="error" class="p-error flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded">
        <i class="pi pi-exclamation-triangle"></i>
        {{ error }}
      </div>

      <div class="flex flex-col gap-3 mt-2">
        <Button 
          type="submit" 
          :label="isLoginMode ? 'Sign In' : 'Create Account'"
          :loading="loading"
          :disabled="loading || oauthLoading"
          class="w-full"
        />
        
        <div class="text-center pt-3 border-t border-surface-300">
          <span class="text-sm text-muted-color">
            {{ isLoginMode ? "Don't have an account?" : "Already have an account?" }}
          </span>
          <Button 
            type="button"
            :label="isLoginMode ? 'Sign Up' : 'Sign In'"
            link
            @click="toggleMode"
            :disabled="loading || oauthLoading"
            class="ml-1 p-0"
          />
        </div>
      </div>
    </form>
  </Dialog>
</template>


<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../composables/ui/useToast'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
}>()

const authStore = useAuthStore()
const toast = useToast();

const visible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
})

const isLoginMode = ref(true)
const loading = ref(false)
const oauthLoading = ref(false)
const error = ref('')
const emailError = ref('')
const passwordError = ref('')

const form = reactive({
  email: '',
  password: '',
  username: ''
})

function resetForm() {
  form.email = ''
  form.password = ''
  form.username = ''
  error.value = ''
  emailError.value = ''
  passwordError.value = ''
}

function toggleMode() {
  isLoginMode.value = !isLoginMode.value
  error.value = ''
  emailError.value = ''
  passwordError.value = ''
}

async function handleSubmit() {
  loading.value = true
  error.value = ''
  emailError.value = ''
  passwordError.value = ''

  try {
    if (isLoginMode.value) {
      const result = await authStore.signIn(form.email, form.password)
      if (result.success) {
        toast.add({ severity: 'success', summary: 'Success', detail: 'Successfully signed in!', life: 3000 })
        visible.value = false
        resetForm()
      } else {
        error.value = result.error || 'Sign in failed'
      }
    } else {
      const result = await authStore.signUp(form.email, form.password, form.username)
      if (result.success) {
        toast.add({ severity: 'success', summary: 'Success', detail: 'Successfully signed up!', life: 3000 })
        visible.value = false
        resetForm()
      } else {
        error.value = result.error || 'Sign up failed'
      }
    }
  } catch (err: any) {
    error.value = err.message || 'An error occurred'
  } finally {
    loading.value = false
  }
}

// AI : Handle OAuth sign in
async function handleOAuthSignIn(provider: 'google' | 'github' | 'discord' | 'facebook') {
  oauthLoading.value = true
  error.value = ''

  try {
    const result = await authStore.signInWithOAuth(provider)
    if (result.success) {
      // AI : OAuth will redirect to provider, then back to our callback
      toast.add({ 
        severity: 'info', 
        summary: 'Redirecting...', 
        detail: `Redirecting to ${provider} for authentication...`,
        life: 3000
      })
    } else {
      error.value = result.error || `${provider} sign in failed`
    }
  } catch (err: any) {
    error.value = err.message || 'An error occurred'
  } finally {
    oauthLoading.value = false
  }
}
</script>