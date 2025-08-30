import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { trpc } from '../client'

// AI : User type for our custom authentication
interface User {
  id: string
  email: string
  username: string | null
  role: string | null
  emailVerified: boolean
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(true)

  // AI : Computed properties
  const isAuthenticated = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  // AI : Initialize auth state
  async function initialize() {
    try {
      loading.value = true
      
      // AI : Try to get current user from server (will use cookies)
      const result = await trpc.auth.me.query()
      user.value = result.user
    } catch (error) {
      console.error('Error initializing auth:', error)
      user.value = null
    } finally {
      loading.value = false
    }
  }

  // AI : Sign up with email and password
  async function signUp(email: string, password: string, username: string) {
    try {
      const result = await trpc.auth.register.mutate({
        email,
        password,
        username,
      })

      return {
        success: result.success,
        user: result.user,
        error: result.success ? null : result.message
      }
    } catch (error: unknown) {
      console.error('Sign up error:', error)
      return { 
        success: false, 
        user: null, 
        error:  error instanceof Error ? error.message : 'Registration failed'
      }
    }
  }

  // AI : Sign in with email and password
  async function signIn(email: string, password: string) {
    try {
      const result = await trpc.auth.login.mutate({
        email,
        password,
      })

      if (result.success) {
        user.value = result.user
      }

      return {
        success: result.success,
        user: result.user,
        error: result.success ? null : result.message
      }
    } catch (error: unknown) {
      console.error('Sign in error:', error)
      return { 
        success: false, 
        user: null, 
        error:  error instanceof Error ? error.message : 'Login failed'
      }
    }
  }

  // AI : OAuth not implemented in custom auth (placeholder)
  async function signInWithOAuth(provider: 'google' | 'github' | 'discord' | 'facebook') {
    console.warn('OAuth authentication not implemented in custom auth system')
    return { 
      success: false, 
      error: 'OAuth authentication not available' 
    }
  }

  // AI : Sign out
  async function signOut() {
    try {
      await trpc.auth.logout.mutate()
      user.value = null
      return { success: true, error: null }
    } catch (error: unknown) {
      console.error('Sign out error:', error)
      // AI : Clear local data even if server logout fails
      user.value = null
      return { success: false, error:  error instanceof Error ? error.message : 'Logout failed' }
    }
  }

  // AI : Verify email
  async function verifyEmail(token: string) {
    try {
      const result = await trpc.auth.verifyEmail.mutate({ token })
      return {
        success: result.success,
        error: result.success ? null : result.message
      }
    } catch (error: unknown) {
      console.error('Email verification error:', error)
      return {
        success: false,
        error:  error instanceof Error ? error.message : 'Email verification failed'
      }
    }
  }

  // AI : Request password reset
  async function requestPasswordReset(email: string) {
    try {
      const result = await trpc.auth.requestPasswordReset.mutate({ email })
      return {
        success: result.success,
        error: result.success ? null : result.message
      }
    } catch (error: unknown) {
      console.error('Password reset request error:', error)
      return {
        success: false,
        error:  error instanceof Error ? error.message : 'Password reset request failed'
      }
    }
  }

  // AI : Reset password
  async function resetPassword(token: string, password: string) {
    try {
      const result = await trpc.auth.resetPassword.mutate({ token, password })
      return {
        success: result.success,
        error: result.success ? null : result.message
      }
    } catch (error: unknown) {
      console.error('Password reset error:', error)
      return {
        success: false,
        error:  error instanceof Error ? error.message : 'Password reset failed'
      }
    }
  }

  // AI : Get authorization header for API calls (cookies are handled automatically)
  function getAuthHeader() {
    return null // AI : No need for auth headers with cookie-based auth
  }

  return {
    user,
    loading,
    isAuthenticated,
    isAdmin,
    initialize,
    signUp,
    signIn,
    signInWithOAuth,
    signOut,
    verifyEmail,
    requestPasswordReset,
    resetPassword,
    getAuthHeader,
  }
})